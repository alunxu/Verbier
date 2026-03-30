#!/usr/bin/env python3
"""
Verbier Festival Programme Scraper
====================================
Scrapes concert programme data from verbierfestival.com.

Strategies:
1. Live site: scrape the current year's programme page
2. Wayback Machine: attempt to retrieve archived programme pages for past years
3. Show URL enumeration: generate candidate show URLs from known audio dates

Usage:
  python3 verbier_programme_scraper.py                    # Scrape current year (2026)
  python3 verbier_programme_scraper.py --year 2022        # Attempt historical year
  python3 verbier_programme_scraper.py --all              # Attempt all years 1994-2026
  python3 verbier_programme_scraper.py --from-audio       # Generate URLs from audio dates

Output:
  programme_data/YYYY_programme.json   : structured concert data per year
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from datetime import datetime, timedelta
from urllib.parse import urljoin, quote

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4"])
    import requests
    from bs4 import BeautifulSoup

# ─── Configuration ───────────────────────────────────────────────────────────
BASE_URL = "https://www.verbierfestival.com"
WAYBACK_CDX_API = "https://web.archive.org/cdx/search/cdx"
WAYBACK_URL = "https://web.archive.org/web"
OUTPUT_DIR = Path("/Volumes/EMPLUS-Students/CDS 2026/Project Space/Verbier/programme_data")
AUDIO_METADATA = Path("/Volumes/EMPLUS-Students/CDS 2026/Project Space/Verbier/parsed_audio_metadata.json")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) VerbierArchiveResearch/1.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
}

# Rate limiting
REQUEST_DELAY = 0.5  # seconds between requests (most will 404 quickly)


# ─── Parsing Functions ────────────────────────────────────────────────────────

def parse_show_page(html: str, url: str) -> dict | None:
    """Parse an individual show/concert page to extract structured data."""
    soup = BeautifulSoup(html, "html.parser")

    result = {
        "url": url,
        "title": None,
        "date": None,
        "time_start": None,
        "time_end": None,
        "venue": None,
        "performers": [],
        "composers": [],
        "works": [],
        "description": None,
        "orchestra": None,
        "event_type": None,
    }

    # Extract title from <h1>
    h1 = soup.find("h1")
    if h1:
        result["title"] = h1.get_text(strip=True)

    # Try to extract from meta tags
    og_title = soup.find("meta", property="og:title")
    if og_title and og_title.get("content"):
        title_content = og_title["content"]
        # Parse the VF show title format: "VF2026 07 18 1830 Così fan tutte"
        match = re.match(r"VF(\d{4})\s+(\d{2})\s+(\d{2})\s+(\d{2})(\d{2})\s+(.*)", title_content)
        if match:
            year, month, day, hour, minute, title = match.groups()
            result["date"] = f"{year}-{month}-{day}"
            result["time_start"] = f"{hour}:{minute}"
            result["title"] = title.strip()

    # Extract from URL pattern: /show/vfYYYY-MM-DD-HHMM/
    url_match = re.search(r"/show/(?:vf|kids)(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})", url)
    if url_match:
        year, month, day, hour, minute = url_match.groups()
        result["date"] = result["date"] or f"{year}-{month}-{day}"
        result["time_start"] = result["time_start"] or f"{hour}:{minute}"

    # Extract performers from musician links
    musician_links = soup.find_all("a", href=re.compile(r"/musician/"))
    for link in musician_links:
        name = link.get_text(strip=True)
        href = link.get("href", "")
        if name and name not in [p["name"] for p in result["performers"]]:
            result["performers"].append({"name": name, "url": href})

    # Extract orchestra/ensemble from orchestra links
    orchestra_links = soup.find_all("a", href=re.compile(r"/orchestra/"))
    for link in orchestra_links:
        name = link.get_text(strip=True)
        if name:
            result["orchestra"] = name

    # Extract venue from venue links
    venue_links = soup.find_all("a", href=re.compile(r"/venue/"))
    for link in venue_links:
        name = link.get_text(strip=True)
        if name:
            result["venue"] = name
            break

    # Extract composers from h6 headings (typically list composers)
    for h6 in soup.find_all("h6"):
        text = h6.get_text(strip=True)
        if text and not text.startswith("http") and len(text) < 200:
            # Composer lists are typically comma-separated
            composers = [c.strip() for c in text.split(",") if c.strip()]
            result["composers"] = composers

    # Extract description from paragraphs
    entry_content = soup.find(class_="entry-content") or soup.find("article")
    if entry_content:
        paragraphs = entry_content.find_all("p")
        desc_parts = []
        for p in paragraphs:
            text = p.get_text(strip=True)
            if text and len(text) > 30 and not text.startswith("http"):
                desc_parts.append(text)
        if desc_parts:
            result["description"] = " ".join(desc_parts[:3])

    # Detect event type from title/content
    title_lower = (result["title"] or "").lower()
    if any(w in title_lower for w in ["récital", "recital"]):
        result["event_type"] = "recital"
    elif any(w in title_lower for w in ["opera", "opéra"]):
        result["event_type"] = "opera"
    elif result["orchestra"]:
        result["event_type"] = "orchestral"
    elif "rencontres" in title_lower or "chamber" in title_lower:
        result["event_type"] = "chamber"
    else:
        result["event_type"] = "concert"

    return result


def parse_programme_page(html: str, base_url: str = BASE_URL) -> list[str]:
    """Extract all show URLs from a programme listing page."""
    soup = BeautifulSoup(html, "html.parser")
    show_urls = set()

    for link in soup.find_all("a", href=True):
        href = link["href"]
        if "/show/" in href:
            full_url = urljoin(base_url, href)
            # Clean up wayback machine URLs if present
            if "web.archive.org" in full_url:
                # Extract the original URL
                orig_match = re.search(r"https?://web\.archive\.org/web/\d+/(https?://.*)", full_url)
                if orig_match:
                    full_url = orig_match.group(1)
            show_urls.add(full_url)

    return sorted(show_urls)


# ─── Scraping Functions ──────────────────────────────────────────────────────

def fetch_page(url: str, session: requests.Session) -> str | None:
    """Fetch a page with retries and rate limiting."""
    time.sleep(REQUEST_DELAY)
    try:
        resp = session.get(url, headers=HEADERS, timeout=30, allow_redirects=True)
        if resp.status_code == 200:
            return resp.text
        elif resp.status_code == 404:
            return None
        else:
            print(f"    ⚠ HTTP {resp.status_code} for {url}")
            return None
    except requests.RequestException as e:
        print(f"    ✗ Error fetching {url}: {e}")
        return None


def scrape_live_programme(year: int, session: requests.Session) -> list[dict]:
    """Scrape the programme from the live verbierfestival.com site."""
    print(f"\n[Live] Fetching programme page for {year}...")

    # Try different URL patterns
    urls_to_try = [
        f"{BASE_URL}/en/programme",
        f"{BASE_URL}/programme",
        f"{BASE_URL}/en/programme-{year}",
        f"{BASE_URL}/programme-{year}",
    ]

    show_urls = set()
    for url in urls_to_try:
        html = fetch_page(url, session)
        if html:
            found = parse_programme_page(html)
            # Filter for the requested year
            year_urls = [u for u in found if f"{year}" in u]
            if year_urls:
                show_urls.update(year_urls)
                print(f"    ✓ Found {len(year_urls)} show links from {url}")
                break

    if not show_urls:
        print(f"    ✗ No show links found for {year} on live site")
        return []

    # Fetch each show page
    concerts = []
    for i, show_url in enumerate(sorted(show_urls)):
        print(f"    [{i+1}/{len(show_urls)}] Fetching {show_url.split('/')[-2]}...")
        html = fetch_page(show_url, session)
        if html:
            concert = parse_show_page(html, show_url)
            if concert:
                concerts.append(concert)

    return concerts


def scrape_wayback_programme(year: int, session: requests.Session) -> list[dict]:
    """
    Attempt to retrieve archived programme pages from the Wayback Machine.
    Festivals typically run mid-July to early August.
    """
    print(f"\n[Wayback] Searching for {year} festival programme archives...")

    # Query the CDX API to find snapshots of the programme page around festival time
    params = {
        "url": f"verbierfestival.com/show/vf{year}*",
        "output": "json",
        "fl": "original,timestamp,statuscode",
        "filter": "statuscode:200",
        "collapse": "original",
        "limit": 500,
    }

    try:
        resp = session.get(WAYBACK_CDX_API, params=params, timeout=30)
        if resp.status_code != 200:
            print(f"    ⚠ CDX API returned {resp.status_code}")
            return []

        data = resp.json()
        if len(data) <= 1:  # First row is headers
            print(f"    ✗ No Wayback Machine snapshots found for {year} show pages")

            # Try to find programme listing page
            params2 = {
                "url": f"verbierfestival.com/programme*",
                "output": "json",
                "fl": "original,timestamp,statuscode",
                "filter": "statuscode:200",
                "from": f"{year}0601",
                "to": f"{year}0901",
                "limit": 20,
            }
            resp2 = session.get(WAYBACK_CDX_API, params=params2, timeout=30)
            if resp2.status_code == 200:
                data2 = resp2.json()
                if len(data2) > 1:
                    print(f"    ✓ Found {len(data2)-1} programme page snapshots")
                    # Use the most recent snapshot
                    for row in data2[1:]:
                        original, timestamp, _ = row
                        wb_url = f"{WAYBACK_URL}/{timestamp}/{original}"
                        print(f"    Trying: {wb_url}")
                        html = fetch_page(wb_url, session)
                        if html:
                            found = parse_programme_page(html, wb_url)
                            if found:
                                print(f"    ✓ Found {len(found)} show links")
                                # Save these for processing
                                return _fetch_show_pages(found, year, session, via_wayback=True)
            return []

        # Process CDX results — we have direct show page URLs
        headers_row = data[0]
        show_urls = {}
        for row in data[1:]:
            original = row[0]
            timestamp = row[1]
            # Only keep unique show URLs, using the latest timestamp
            if original not in show_urls or timestamp > show_urls[original]:
                show_urls[original] = timestamp

        print(f"    ✓ Found {len(show_urls)} unique show pages in Wayback Machine")

        concerts = []
        for i, (original, timestamp) in enumerate(sorted(show_urls.items())):
            wb_url = f"{WAYBACK_URL}/{timestamp}/{original}"
            show_name = original.split("/show/")[-1].rstrip("/") if "/show/" in original else original
            print(f"    [{i+1}/{len(show_urls)}] Fetching {show_name}...")
            html = fetch_page(wb_url, session)
            if html:
                concert = parse_show_page(html, original)
                if concert:
                    concert["wayback_url"] = wb_url
                    concert["wayback_timestamp"] = timestamp
                    concerts.append(concert)

        return concerts

    except Exception as e:
        print(f"    ✗ Wayback Machine error: {e}")
        return []


def _fetch_show_pages(show_urls: list[str], year: int, session: requests.Session,
                      via_wayback: bool = False) -> list[dict]:
    """Fetch individual show pages."""
    concerts = []
    for i, url in enumerate(sorted(show_urls)):
        if str(year) not in url:
            continue
        show_name = url.split("/show/")[-1].rstrip("/") if "/show/" in url else url
        print(f"    [{i+1}/{len(show_urls)}] Fetching {show_name}...")
        html = fetch_page(url, session)
        if html:
            concert = parse_show_page(html, url)
            if concert:
                if via_wayback:
                    concert["source"] = "wayback_machine"
                concerts.append(concert)
    return concerts


def generate_urls_from_audio() -> dict[int, list[str]]:
    """
    Generate candidate show URLs from known audio recording dates.
    Uses the parsed audio metadata to produce vfYYYY-MM-DD-HHMM URLs.
    """
    print("\n[Audio→URLs] Generating candidate show URLs from audio dates...")

    if not AUDIO_METADATA.exists():
        print("    ✗ No parsed audio metadata found. Run score_audio_linkage_analysis.py first.")
        return {}

    with open(AUDIO_METADATA, "r") as f:
        audio_data = json.load(f)

    urls_by_year = {}
    for rec in audio_data:
        date = rec.get("date")
        year = rec.get("year")
        time_str = rec.get("time")
        venue = rec.get("venue_code", "")

        if not date or not year:
            continue

        # Generate time slots to try: the recorded time and nearby common slots
        times_to_try = set()
        if time_str:
            h, m = time_str.split(":")[:2]
            times_to_try.add(f"{int(h):02d}00")
            times_to_try.add(f"{int(h):02d}30")
        # Common concert times
        times_to_try.update(["1100", "1130", "1500", "1530", "1830", "1900", "1930", "2000", "2030"])

        date_parts = date.split("-")
        if len(date_parts) != 3:
            continue
        y, m, d = date_parts

        if year not in urls_by_year:
            urls_by_year[year] = set()

        for t in times_to_try:
            url = f"{BASE_URL}/show/vf{y}-{m}-{d}-{t}/"
            urls_by_year[year].add(url)

    # Convert sets to sorted lists
    for year in urls_by_year:
        urls_by_year[year] = sorted(urls_by_year[year])

    total = sum(len(urls) for urls in urls_by_year.values())
    print(f"    ✓ Generated {total} candidate URLs across {len(urls_by_year)} years")
    return urls_by_year


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Verbier Festival Programme Scraper")
    parser.add_argument("--year", type=int, help="Scrape a specific year")
    parser.add_argument("--all", action="store_true", help="Attempt all years 1994-2026")
    parser.add_argument("--from-audio", action="store_true",
                        help="Generate and test show URLs from audio dates")
    parser.add_argument("--wayback-only", action="store_true",
                        help="Only use Wayback Machine (skip live site)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Generate URLs but don't fetch them")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()

    print("=" * 70)
    print("  Verbier Festival Programme Scraper")
    print("=" * 70)

    if args.from_audio:
        urls_by_year = generate_urls_from_audio()
        if args.dry_run:
            output_file = OUTPUT_DIR / "candidate_show_urls.json"
            with open(output_file, "w") as f:
                json.dump({str(k): v for k, v in urls_by_year.items()}, f, indent=2)
            print(f"\n  Candidate URLs saved to: {output_file}")
            return

        # Test generated URLs
        for year in sorted(urls_by_year.keys()):
            urls = urls_by_year[year]
            print(f"\n  Testing {len(urls)} URLs for {year}...")
            concerts = []
            found = 0
            for i, url in enumerate(urls):
                show_name = url.split("/show/")[-1].rstrip("/")
                html = fetch_page(url, session)
                if html:
                    concert = parse_show_page(html, url)
                    if concert and concert["title"]:
                        concerts.append(concert)
                        found += 1
                        print(f"    ✓ [{found}] {show_name} → {concert['title']}")
                if (i + 1) % 50 == 0:
                    print(f"    ... tested {i+1}/{len(urls)} URLs ...")

            if concerts:
                output_file = OUTPUT_DIR / f"{year}_programme.json"
                with open(output_file, "w", encoding="utf-8") as f:
                    json.dump(concerts, f, indent=2, ensure_ascii=False)
                print(f"    → Saved {len(concerts)} concerts to {output_file}")

        return

    # Determine years to process
    if args.all:
        years = list(range(1994, 2027))
    elif args.year:
        years = [args.year]
    else:
        years = [2026]  # Default: current year

    all_results = {}

    for year in years:
        print(f"\n{'='*50}")
        print(f"  Processing year: {year}")
        print(f"{'='*50}")

        concerts = []

        # Strategy 1: Try live site (only works for current year)
        if not args.wayback_only:
            live_concerts = scrape_live_programme(year, session)
            if live_concerts:
                concerts.extend(live_concerts)
                print(f"    Live site: {len(live_concerts)} concerts found")

        # Strategy 2: Wayback Machine
        if not concerts:
            wb_concerts = scrape_wayback_programme(year, session)
            if wb_concerts:
                concerts.extend(wb_concerts)
                print(f"    Wayback: {len(wb_concerts)} concerts found")

        if concerts:
            output_file = OUTPUT_DIR / f"{year}_programme.json"
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(concerts, f, indent=2, ensure_ascii=False)
            print(f"\n    → Saved {len(concerts)} concerts to {output_file}")
            all_results[year] = len(concerts)
        else:
            print(f"\n    ✗ No programme data found for {year}")
            all_results[year] = 0

    # Summary
    print("\n" + "=" * 70)
    print("  SCRAPING SUMMARY")
    print("=" * 70)
    total = sum(all_results.values())
    for year, count in sorted(all_results.items()):
        status = f"{count} concerts" if count > 0 else "no data"
        print(f"    {year}: {status}")
    print(f"\n    Total: {total} concerts scraped across {sum(1 for c in all_results.values() if c > 0)} years")

    # Save summary
    summary_file = OUTPUT_DIR / "scraping_summary.json"
    with open(summary_file, "w") as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "results_by_year": all_results,
            "total_concerts": total,
        }, f, indent=2)
    print(f"    Summary saved to: {summary_file}")


if __name__ == "__main__":
    main()

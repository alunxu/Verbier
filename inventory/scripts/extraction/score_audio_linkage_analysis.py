#!/usr/bin/env python3
"""
Verbier Festival Archive — Score-to-Audio Linkage Analysis
==========================================================
Parses audio and score naming conventions, cross-references them,
and produces a linkage feasibility report.

Output:
  - linkage_report.json   : structured linkage data
  - Console summary       : human-readable overview
"""

import os
import re
import json
from pathlib import Path
from collections import defaultdict
from datetime import datetime

# ─── Configuration ───────────────────────────────────────────────────────────
DATASET_ROOT = Path("/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive")
OUTPUT_DIR = Path("/Volumes/EMPLUS-Students/CDS 2026/Project Space/Verbier")

AUDIO_MUSICA_NUMERIS = DATASET_ROOT / "Audio" / "Fichiers CD Musica Numeris"
AUDIO_NUMERISATIONS = DATASET_ROOT / "Audio" / "Numérisations"
SCORES_ROOT = DATASET_ROOT / "Scores" / "verbier-musical-scores" / "30D000L6" / "musical-scores"

# Venue code mapping
VENUE_CODES = {
    "M": "Médran (Salle des Combins)",
    "E": "Église de Verbier",
    "X": "External / Unknown",
    "H": "Hameau",
    "C": "Cinéma de Verbier",
    "A": "Autre / Other",
    "R": "Rehearsal / Other",
    "medran": "Médran (Salle des Combins)",
    "meldran": "Médran (Salle des Combins)",  # typo variant
    "eglise": "Église de Verbier",
    "eglie": "Église de Verbier",  # typo variant
    "combins": "Salle des Combins",
    "cinema": "Cinéma de Verbier",
}

# Known conductor/performer names found in score folders
KNOWN_PERFORMERS = [
    "Rattle", "Dutoit", "Makela", "Mäkelä", "Zukerman", "Bell", "Kavakos",
    "Harding", "Bychkov", "Bloomstedt", "Schiff", "Mehta", "Goebel", "Guzzo",
    "Pletnev", "Honeck", "Altinoglu", "Nagano", "Kochanovsky", "Gonzales",
    "Takács-Nagy", "Noseda", "Gaffigan", "Shani", "Welser-Möst",
]

# Known ensemble abbreviations
ENSEMBLE_CODES = {
    "VFO": "Verbier Festival Orchestra",
    "VFCO": "Verbier Festival Chamber Orchestra",
    "VFJO": "Verbier Festival Junior Orchestra",
    "VF": "Verbier Festival (general)",
    "ONL": "Orchestre National de Lyon",
    "OSR": "Orchestre de la Suisse Romande",
    "OCL": "Orchestre de Chambre de Lausanne",
    "GTN": "General / GTN edition",
    "MET": "Metropolitan Opera",
}


# ─── Audio Parsers ────────────────────────────────────────────────────────────

def parse_musica_numeris_folder(folder_name: str) -> dict | None:
    """
    Parse folder name like '20000722190000_medran0203'
    Format: YYYYMMDDHHMMSS_venue+indices
    """
    match = re.match(
        r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_([a-zA-Z]+)(\d*)",
        folder_name,
    )
    if not match:
        return None

    year, month, day, hour, minute, second, venue, index = match.groups()
    venue_norm = venue.lower()
    venue_name = VENUE_CODES.get(venue_norm, venue)

    year_int = int(year)
    # Sanity check: Verbier Festival runs 1994–present
    if year_int < 1990 or year_int > 2030:
        return None

    return {
        "source": "musica_numeris",
        "folder_name": folder_name,
        "date": f"{year}-{month}-{day}",
        "time": f"{hour}:{minute}",
        "year": year_int,
        "month": int(month),
        "day": int(day),
        "venue_code": venue_norm,
        "venue_name": venue_name,
        "index": index or None,
    }


def parse_numerisation_filename(filename: str) -> dict | None:
    """
    Parse filename like 'M95071419A11DT.wav' or 'E09071820A11CD.wav'
    Format: V YY MMDD HH A NN MT
      V  = Venue code (M, E, X, H, C, etc.)
      YY = 2-digit year
      MMDD = month + day (or XX for unknown)
      HH = hour (or XX for unknown)
      A  = Side/part (A, B, C, ...)
      NN = Copy/version
      MT = Media type (DT, CD, VD, CC)
    """
    # Remove file extension and leading underscore
    basename = filename.rsplit(".", 1)[0].lstrip("_")

    # Pattern: VenueCode + YY + MMDD + HH + side + version + MediaType
    match = re.match(
        r"([A-Z])(\d{2})([\dX]{4})([\dX]{2})([A-Z])(\d{2})([A-Z]{2})",
        basename,
    )
    if not match:
        return None

    venue_letter, yy, mmdd, hh, side, version, media_type = match.groups()

    # Determine full year
    yy_int = int(yy) if yy.isdigit() else None
    if yy_int is not None:
        year = 1900 + yy_int if yy_int >= 90 else 2000 + yy_int
    else:
        year = None

    # Parse month/day
    if mmdd != "XXXX" and mmdd.isdigit():
        month = int(mmdd[:2])
        day = int(mmdd[2:])
    else:
        month, day = None, None

    # Parse hour
    hour = int(hh) if hh != "XX" and hh.isdigit() else None

    venue_name = VENUE_CODES.get(venue_letter, f"Unknown ({venue_letter})")

    date_str = None
    if year and month and day:
        date_str = f"{year}-{month:02d}-{day:02d}"

    time_str = None
    if hour is not None:
        time_str = f"{hour:02d}:00"

    media_type_full = {
        "DT": "DAT",
        "CD": "CD",
        "VD": "DVD",
        "CC": "Compact Cassette",
    }.get(media_type, media_type)

    return {
        "source": f"numerisation_{media_type_full.lower().replace(' ', '_')}",
        "filename": filename,
        "date": date_str,
        "time": time_str,
        "year": year,
        "month": month,
        "day": day,
        "venue_code": venue_letter,
        "venue_name": venue_name,
        "side": side,
        "version": version,
        "media_type": media_type_full,
    }


# ─── Score Parser ─────────────────────────────────────────────────────────────

def parse_score_folder(composer_dir: str, work_dir: str, edition_dir: str) -> dict:
    """
    Parse the score folder hierarchy: COMPOSER / WORK / EDITION
    Extract any year tags, conductor names, and ensemble references.
    """
    result = {
        "composer": composer_dir,
        "work_folder": work_dir,
        "edition_folder": edition_dir,
        "years": [],
        "conductors": [],
        "ensembles": [],
        "edition_type": None,
        "is_conductor_annotation": False,
    }

    full_name = edition_dir

    # Check for Conductor Annotation prefix
    if full_name.startswith("CA ") or full_name.startswith("CA_"):
        result["is_conductor_annotation"] = True
        result["edition_type"] = "conductor_annotation"
    elif "mat" in full_name.lower():
        result["edition_type"] = "material"
    elif any(pub in full_name for pub in ["Breitkopf", "Barenreiter", "Bärenreiter", 
                                           "Kalmus", "Henle", "Peters", "Sikorski",
                                           "Universal", "Schott", "Simrock", "Lucks",
                                           "Doblinger"]):
        result["edition_type"] = "published_edition"

    # Extract years (4-digit, 2000-2029)
    year_matches = re.findall(r'(?:20[0-2]\d)', full_name)
    result["years"] = [int(y) for y in year_matches]

    # Extract conductor/performer names
    for performer in KNOWN_PERFORMERS:
        if performer.lower() in full_name.lower():
            result["conductors"].append(performer)

    # Extract ensemble codes
    for code, name in ENSEMBLE_CODES.items():
        # Use word boundary awareness
        if re.search(rf'\b{re.escape(code)}\b', full_name):
            result["ensembles"].append({"code": code, "name": name})

    return result


# ─── Data Collection ──────────────────────────────────────────────────────────

def collect_audio_data() -> list[dict]:
    """Collect all parsed audio metadata."""
    audio_records = []

    # 1. Musica Numeris
    if AUDIO_MUSICA_NUMERIS.exists():
        for year_dir in sorted(AUDIO_MUSICA_NUMERIS.iterdir()):
            if not year_dir.is_dir() or year_dir.name.startswith("."):
                continue
            for concert_dir in sorted(year_dir.iterdir()):
                if not concert_dir.is_dir() or concert_dir.name.startswith("."):
                    continue
                parsed = parse_musica_numeris_folder(concert_dir.name)
                if parsed:
                    # Count tracks
                    tracks = [f for f in concert_dir.iterdir() if f.suffix.lower() in (".aiff", ".wav", ".mp3")]
                    parsed["track_count"] = len(tracks)
                    parsed["full_path"] = str(concert_dir)
                    audio_records.append(parsed)
                else:
                    audio_records.append({
                        "source": "musica_numeris",
                        "folder_name": concert_dir.name,
                        "parse_error": True,
                        "full_path": str(concert_dir),
                    })

    # 2. Numérisations (CD, DAT, DVD, Cassette)
    if AUDIO_NUMERISATIONS.exists():
        for media_dir in AUDIO_NUMERISATIONS.iterdir():
            if not media_dir.is_dir():
                continue
            for item in media_dir.rglob("*.wav"):
                parsed = parse_numerisation_filename(item.name)
                if parsed:
                    parsed["full_path"] = str(item)
                    audio_records.append(parsed)

            # Also handle DVD folders (which contain .mkv)
            if media_dir.name == "DVD":
                for dvd_dir in media_dir.iterdir():
                    if not dvd_dir.is_dir():
                        continue
                    parsed = parse_numerisation_filename(dvd_dir.name + ".wav")
                    if parsed:
                        parsed["source"] = "numerisation_dvd"
                        parsed["full_path"] = str(dvd_dir)
                        parsed["filename"] = dvd_dir.name
                        audio_records.append(parsed)

    return audio_records


def collect_score_data() -> list[dict]:
    """Collect all parsed score metadata."""
    score_records = []

    if not SCORES_ROOT.exists():
        return score_records

    for composer_dir in sorted(SCORES_ROOT.iterdir()):
        if not composer_dir.is_dir():
            continue
        for work_dir in sorted(composer_dir.iterdir()):
            if not work_dir.is_dir():
                continue
            for edition_dir in sorted(work_dir.iterdir()):
                if not edition_dir.is_dir():
                    continue
                parsed = parse_score_folder(
                    composer_dir.name, work_dir.name, edition_dir.name
                )
                # Count PDF files
                pdfs = list(edition_dir.rglob("*.pdf"))
                parsed["pdf_count"] = len(pdfs)
                parsed["full_path"] = str(edition_dir)
                score_records.append(parsed)

    return score_records


# ─── Linkage Analysis ─────────────────────────────────────────────────────────

def analyze_linkage(audio_data: list[dict], score_data: list[dict]) -> dict:
    """Cross-reference audio and scores to assess linking feasibility."""

    report = {
        "audio_summary": {},
        "score_summary": {},
        "linkage_analysis": {},
        "best_effort_matches": [],
    }

    # ─── Audio Summary ────
    audio_by_year = defaultdict(list)
    audio_by_source = defaultdict(int)
    audio_dates = set()
    parse_errors = 0

    for rec in audio_data:
        if rec.get("parse_error"):
            parse_errors += 1
            continue
        source = rec.get("source", "unknown")
        audio_by_source[source] += 1
        year = rec.get("year")
        if year:
            audio_by_year[year].append(rec)
        date = rec.get("date")
        if date:
            audio_dates.add(date)

    report["audio_summary"] = {
        "total_records": len(audio_data),
        "parse_errors": parse_errors,
        "by_source": dict(audio_by_source),
        "years_covered": sorted(audio_by_year.keys()),
        "unique_dates": len(audio_dates),
        "records_per_year": {y: len(recs) for y, recs in sorted(audio_by_year.items())},
    }

    # ─── Score Summary ────
    scores_with_years = [s for s in score_data if s["years"]]
    scores_with_conductors = [s for s in score_data if s["conductors"]]
    scores_with_ensembles = [s for s in score_data if s["ensembles"]]
    conductor_annotations = [s for s in score_data if s["is_conductor_annotation"]]

    all_score_years = set()
    for s in score_data:
        all_score_years.update(s["years"])

    all_conductors = defaultdict(int)
    for s in score_data:
        for c in s["conductors"]:
            all_conductors[c] += 1

    all_ensembles = defaultdict(int)
    for s in score_data:
        for e in s["ensembles"]:
            all_ensembles[e["code"]] += 1

    composers_set = set(s["composer"] for s in score_data)

    report["score_summary"] = {
        "total_editions": len(score_data),
        "unique_composers": len(composers_set),
        "composers": sorted(composers_set),
        "editions_with_year_tags": len(scores_with_years),
        "editions_with_conductor_names": len(scores_with_conductors),
        "editions_with_ensemble_refs": len(scores_with_ensembles),
        "conductor_annotations": len(conductor_annotations),
        "years_found_in_scores": sorted(all_score_years),
        "conductors_found": dict(sorted(all_conductors.items(), key=lambda x: -x[1])),
        "ensembles_found": dict(sorted(all_ensembles.items(), key=lambda x: -x[1])),
    }

    # ─── Linkage Analysis ────
    # Find years where BOTH audio and scores exist
    audio_years = set(audio_by_year.keys())
    score_years = all_score_years
    overlap_years = sorted(audio_years & score_years)

    report["linkage_analysis"] = {
        "audio_year_range": f"{min(audio_years) if audio_years else '?'}–{max(audio_years) if audio_years else '?'}",
        "score_year_range": f"{min(score_years) if score_years else '?'}–{max(score_years) if score_years else '?'}",
        "overlapping_years": overlap_years,
        "overlap_count": len(overlap_years),
    }

    # ─── Best-Effort Matches ──── 
    # For scores with year tags, try to find corresponding audio from the same year
    matches = []
    unmatched_scores = []

    for score in scores_with_years:
        for year in score["years"]:
            audio_in_year = audio_by_year.get(year, [])
            if audio_in_year:
                # We know: composer, work, year, possibly conductor
                match_entry = {
                    "composer": score["composer"],
                    "work": score["work_folder"],
                    "edition": score["edition_folder"],
                    "score_year": year,
                    "conductors_in_score": score["conductors"],
                    "ensembles_in_score": [e["code"] for e in score["ensembles"]],
                    "audio_recordings_same_year": len(audio_in_year),
                    "match_confidence": "medium",
                    "note": (
                        "Year matches but specific concert date unknown without programme data. "
                        f"{len(audio_in_year)} audio recordings exist from {year}."
                    ),
                }
                if score["conductors"]:
                    match_entry["match_confidence"] = "medium-high"
                    match_entry["note"] += (
                        f" Conductor(s) {', '.join(score['conductors'])} identified, "
                        "which can be verified against programme data."
                    )
                matches.append(match_entry)
            else:
                unmatched_scores.append({
                    "composer": score["composer"],
                    "work": score["work_folder"],
                    "edition": score["edition_folder"],
                    "score_year": year,
                    "reason": f"No audio recordings found for year {year}"
                })

    report["best_effort_matches"] = matches
    report["unmatched_scores_with_years"] = unmatched_scores

    # ─── Summary Statistics ────
    total_with_year = len(scores_with_years)
    matched = len(matches)
    report["linkage_analysis"]["scores_with_year_linked_to_audio_year"] = matched
    report["linkage_analysis"]["scores_with_year_no_audio"] = len(unmatched_scores)
    report["linkage_analysis"]["scores_without_any_year"] = len(score_data) - total_with_year
    report["linkage_analysis"]["linkage_rate_with_year"] = (
        f"{matched}/{total_with_year} ({matched/max(total_with_year,1)*100:.1f}%)"
    )
    report["linkage_analysis"]["overall_linkage_rate"] = (
        f"{matched}/{len(score_data)} ({matched/max(len(score_data),1)*100:.1f}%)"
    )

    return report


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("  Verbier Festival Archive — Score-to-Audio Linkage Analysis")
    print("=" * 70)
    print()

    # Collect data
    print("[1/3] Parsing audio metadata...")
    audio_data = collect_audio_data()
    print(f"      → {len(audio_data)} audio records collected")

    print("[2/3] Parsing score metadata...")
    score_data = collect_score_data()
    print(f"      → {len(score_data)} score editions collected")

    print("[3/3] Analyzing cross-references...")
    report = analyze_linkage(audio_data, score_data)

    # Save JSON report
    output_file = OUTPUT_DIR / "inventory" / "overview" / "linkage_report.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\n      → Report saved to: {output_file}")

    # Print summary
    print("\n" + "=" * 70)
    print("  SUMMARY")
    print("=" * 70)

    a = report["audio_summary"]
    s = report["score_summary"]
    l = report["linkage_analysis"]

    print(f"\n{'AUDIO':}")
    print(f"  Total records:    {a['total_records']} ({a['parse_errors']} parse errors)")
    print(f"  By source:")
    for src, count in a["by_source"].items():
        print(f"    {src:30s} {count:5d}")
    print(f"  Years covered:    {a['years_covered'][0]}–{a['years_covered'][-1]}" if a['years_covered'] else "  Years: none")
    print(f"  Unique dates:     {a['unique_dates']}")

    print(f"\n{'SCORES':}")
    print(f"  Total editions:           {s['total_editions']}")
    print(f"  Unique composers:         {s['unique_composers']}")
    print(f"  Conductor annotations:    {s['conductor_annotations']}")
    print(f"  With year tags:           {s['editions_with_year_tags']}")
    print(f"  With conductor names:     {s['editions_with_conductor_names']}")
    print(f"  With ensemble refs:       {s['editions_with_ensemble_refs']}")
    print(f"  Years found:              {s['years_found_in_scores']}")
    print(f"  Conductors found:")
    for name, count in list(s["conductors_found"].items())[:10]:
        print(f"    {name:25s} {count:3d} editions")

    print(f"\n{'LINKAGE':}")
    print(f"  Audio year range:         {l['audio_year_range']}")
    print(f"  Score year range:         {l['score_year_range']}")
    print(f"  Overlapping years:        {l['overlap_count']} years")
    print(f"  Overlapping years list:   {l['overlapping_years']}")
    print(f"  Score→Audio (with year):  {l['linkage_rate_with_year']}")
    print(f"  Score→Audio (overall):    {l['overall_linkage_rate']}")
    print(f"  Scores missing audio yr:  {l['scores_with_year_no_audio']}")
    print(f"  Scores without any year:  {l['scores_without_any_year']}")

    print("\n" + "=" * 70)
    print("  KEY INSIGHT")
    print("=" * 70)
    print("""
  Scores with year tags can be linked to the CORRECT YEAR of audio,
  but reaching the specific CONCERT requires programme data (who
  performed what, when). The programme scraper will bridge this gap.

  Conductor annotations (CA) are especially valuable — they link
  a specific score edition to a named conductor, which, combined
  with a year tag, strongly identifies a unique concert event.
    """)

    # Also save the parsed data for downstream use
    audio_output = OUTPUT_DIR / "inventory" / "overview" / "metadata" / "parsed_audio_metadata.json"
    with open(audio_output, "w", encoding="utf-8") as f:
        json.dump(audio_data, f, indent=2, ensure_ascii=False)
    print(f"  Parsed audio metadata saved to: {audio_output}")

    score_output = OUTPUT_DIR / "inventory" / "overview" / "metadata" / "parsed_score_metadata.json"
    with open(score_output, "w", encoding="utf-8") as f:
        json.dump(score_data, f, indent=2, ensure_ascii=False)
    print(f"  Parsed score metadata saved to: {score_output}")


if __name__ == "__main__":
    main()

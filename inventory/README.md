# Verbier Festival Archive — Inventory & Reconciliation Pipeline

> A comprehensive metadata reconciliation system that cross-references 30 years of Verbier Festival audio recordings, video DVDs, printed musical scores, and historical concert programmes into a unified, queryable SQLite database.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Data Sources](#data-sources)
- [Pipeline Stages](#pipeline-stages)
  - [Stage 1: Metadata Extraction](#stage-1-metadata-extraction)
  - [Stage 2: Programme Scraping](#stage-2-programme-scraping)
  - [Stage 3: Database Reconciliation](#stage-3-database-reconciliation)
- [Current Coverage](#current-coverage)
- [Key Design Decisions](#key-design-decisions)
- [How to Run](#how-to-run)
- [Known Limitations](#known-limitations)
- [Next Steps](#next-steps)

---

## Project Overview

The Verbier Festival (founded 1994) maintains an extensive physical archive of:
- **974 audio recordings** (DAT/CD bounces of concerts and masterclasses)
- **41 video/DVD recordings** of select performances
- **601 printed musical scores** (orchestral parts, chamber music, solo repertoire)
- **30+ years of concert programmes** (1994–2026)

These assets were historically catalogued in separate, disconnected Excel spreadsheets with inconsistent naming conventions. This inventory pipeline was built to **reconcile all four datasets into a single relational database**, enabling cross-referencing between a physical audio recording, the concert it was performed at, and the printed score that was used.

The output database (`verbier_archive.sqlite`) serves as the authoritative source of truth for the **Verbier Curator** web application — a browser-based installation that allows gesture-controlled navigation and mixing of the festival's historical recordings.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    RAW DATA SOURCES                         │
│  (Excel spreadsheets on Synology NAS — read-only)          │
├─────────────┬──────────────┬──────────────┬─────────────────┤
│ Audio .xlsx │ Video .xlsx  │ Scores .xlsx │ Wayback Machine │
└──────┬──────┴──────┬───────┴──────┬───────┴────────┬────────┘
       │             │              │                │
       ▼             ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│              STAGE 1: METADATA EXTRACTION                   │
│  score_audio_linkage_analysis.py                            │
│  parse_video_metadata.py                                    │
│  → Outputs: parsed_audio_metadata.json                      │
│             parsed_score_metadata.json                      │
│             parsed_video_metadata.json                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              STAGE 2: PROGRAMME SCRAPING                    │
│  verbier_programme_scraper.py                               │
│  → Scrapes verbierfestival.com via Wayback Machine CDX API  │
│  → Outputs: YYYY_programme.json (per year)                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              STAGE 3: DATABASE RECONCILIATION               │
│  build_reconciliation_db.py                                 │
│  → Merges all metadata + programme data                     │
│  → Applies "Media String Fallback" for 1994–2001            │
│  → Outputs: verbier_archive.sqlite                          │
│             video_audio_matches.json                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
Verbier/
├── README.md                          # Repository overview and app/data walkthrough
├── docs/
│   └── media-assets.md                # NAS/media recovery and runtime asset notes
├── verbier_archive.sqlite             # ★ Final reconciled database (1.4 MB)
│
├── inventory/                         # All inventory pipeline code & outputs
│   ├── README.md                      # ★ This file
│   │
│   ├── scripts/
│   │   ├── extraction/                # Stage 1 & 2 scripts
│   │   │   ├── score_audio_linkage_analysis.py   # Parses Excel → JSON metadata
│   │   │   ├── parse_video_metadata.py           # Parses video DVD Excel → JSON
│   │   │   └── verbier_programme_scraper.py      # Wayback Machine historical scraper
│   │   │
│   │   └── reconciliation/            # Stage 3 scripts
│   │       └── build_reconciliation_db.py        # Master DB builder
│   │
│   ├── programme_data/                # Scraped concert programme JSONs
│   │   ├── YYYY_programme.json        # Year-level scraped programme outputs
│   │   ├── candidate_show_urls.json   # URL cache for Wayback lookups
│   │   ├── scraping_summary.json      # Machine-readable scraping results
│   │   └── raw_html/                  # Ignored cached HTML snapshots
│   │
│   ├── overview/                      # Reports, analysis, and derived data
│   │   ├── dataset_exploration_report.md    # Full dataset analysis & strategy
│   │   ├── sankey_diagram.md                # Mermaid linkage visualization
│   │   ├── linkage_report.json              # Detailed per-record linkage results
│   │   ├── video_audio_matches.json         # Video↔Audio bridge for curator app
│   │   └── metadata/                        # Intermediate parsed JSONs
│   │       ├── parsed_audio_metadata.json   # 974 audio records
│   │       ├── parsed_score_metadata.json   # 601 score records
│   │       └── parsed_video_metadata.json   # 41 video records
│   │
│   └── logs/                          # Ignored local scraper execution logs
│
└── verbier-curator/                   # Frontend web application (Vite + JS)
    ├── index.html                     # Splash entry point
    ├── choose.html                    # Role choice page
    ├── become-conductor.html          # Current gesture-controlled experience
    ├── gesture-guide.html             # Gesture tutorial/reference page
    ├── follow.html                    # Follow-the-conductor gallery/video view
    ├── package.json
    ├── vite.config.js
    ├── src/
    │   ├── main.js                    # Splash logic and routing
    │   ├── style.css                  # Splash/global styles
    │   ├── splash-canvas.js           # Animated splash screen
    │   ├── become-conductor/          # Current conducting proxy module
    │   ├── legacy/                    # Archived earlier prototypes
    │   └── shared/                    # Shared utilities
    └── public/                        # Static UI assets and lightweight data
```

---

## Data Sources

All raw data lives on the EMPLUS Synology NAS at:
```
/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/
```

| Source File | Description | Records |
|:---|:---|:---|
| `vf_audio_inventaire_AS.xlsx` | Audio recording inventory (all formats) | 974 |
| `vf_audio_inventaire_AS_DVD Only.xlsx` | DVD/Video subset with descriptions | 41 |
| `Score Catalog.xlsx` | Physical score library catalog | 601 |
| `verbierfestival.com` (via Wayback Machine) | Historical concert programmes | 1,280+ |

> **Important:** The `Datasets/` directory is treated as **read-only**. All derived outputs are written exclusively to `Project Space/Verbier/inventory/`.

---

## Pipeline Stages

### Stage 1: Metadata Extraction

**Scripts:**
- `score_audio_linkage_analysis.py` — Reads both Excel files, normalizes composer names, extracts year/date/venue metadata, and exports structured JSON. Also produces `linkage_report.json` with per-record fuzzy matching results.
- `parse_video_metadata.py` — Reads the DVD-only Excel sheet and extracts folder names, timestamps, venue codes, and description strings.

**Run:**
```bash
python3 inventory/scripts/extraction/score_audio_linkage_analysis.py
python3 inventory/scripts/extraction/parse_video_metadata.py
```

**Outputs:**
- `inventory/overview/metadata/parsed_audio_metadata.json` (974 records)
- `inventory/overview/metadata/parsed_score_metadata.json` (601 records)
- `inventory/overview/metadata/parsed_video_metadata.json` (41 records)
- `inventory/overview/linkage_report.json`

### Stage 2: Programme Scraping

**Script:** `verbier_programme_scraper.py`

This scraper uses three strategies to recover historical festival schedules:

1. **Live Site** (2026 only) — Fetches current programme from `verbierfestival.com/en/programme`
2. **Wayback CDX API** (2009+) — Queries the Internet Archive's CDX index for archived `/show/` pages and parses structured concert data
3. **Historical Broad Sweep** (1994–2008) — Sweeps the full `verbierfestival.com/*` domain via CDX, downloads all archived HTML pages for the festival season (June–August), and applies heuristic composer/performer extraction from raw HTML

**Date Recovery:** For years 1994–2001, the HTML pages often lack explicit dates. A two-part heuristic system was implemented:
- Checks for date-encoded filenames (e.g., `070804_en.html` → August 4, 2007)
- Falls back to HTTP header timestamps from the Wayback Machine snapshot

**Run:**
```bash
# Scrape all years
python3 inventory/scripts/extraction/verbier_programme_scraper.py --all --historical

# Scrape a single year
python3 inventory/scripts/extraction/verbier_programme_scraper.py --year 2015 --historical

# Scrape only the current live site
python3 inventory/scripts/extraction/verbier_programme_scraper.py
```

**Outputs:** `inventory/programme_data/YYYY_programme.json`

### Stage 3: Database Reconciliation

**Script:** `build_reconciliation_db.py`

This is the master builder that fuses all three metadata streams into a single SQLite database. It:

1. **Creates the schema** — Tables: `concerts`, `concert_composers`, `audio_recordings`, `video_recordings`, `score_inventory`, `concert_scores`
2. **Resolves Concert events** — Groups audio records by `(date, venue_code)` to create unique Concert entities, then links them to scraped programme data by fuzzy date matching
3. **Applies the Media String Fallback** — For audio/video records where no programme data exists (particularly 1994–2001), it scans folder names and video descriptions against a `KNOWN_COMPOSERS` whitelist and directly inserts composer tags. This enables score bridging even without internet archive data.
4. **Bridges Scores to Concerts** — Joins `concert_composers` to `score_inventory` on normalized composer name to create `concert_scores` linkages
5. **Exports curator JSON** — Writes `video_audio_matches.json` for the frontend app

**Run:**
```bash
python3 inventory/scripts/reconciliation/build_reconciliation_db.py
```

**Output:** `verbier_archive.sqlite` (root of project)

---

## Current Coverage

### Programme Data (as of 2026-03-30)

| Year | Concerts | Source | Notes |
|:---|---:|:---|:---|
| 1994 | 0 | — | No Wayback data exists |
| 1995 | 0 | — | No Wayback data exists |
| 1996 | 0 | — | No Wayback data exists |
| 1997 | 8 | Wayback | Partial snapshot |
| 1998 | 0 | — | No Wayback data exists |
| 1999 | 0 | — | No Wayback data exists |
| 2000 | 7 | Wayback | Partial snapshot |
| 2001 | 22 | Wayback | Early HTML tables |
| 2002 | 30 | Wayback | Full festival span |
| 2003 | 21 | Wayback | Full festival span |
| 2004 | 178 | Wayback | Includes masterclasses |
| 2005 | 8 | Wayback | Partial snapshot |
| 2006 | 23 | Wayback | Partial snapshot |
| 2007 | 136 | Wayback | Full modern DOM |
| 2008 | 76 | Wayback | Full modern DOM |
| 2009 | 28 | Wayback | Partial snapshot |
| 2010 | 182 | Wayback | Full modern DOM |
| 2011 | 88 | Wayback | Full modern DOM |
| 2012 | 157 | Wayback | Full modern DOM |
| 2013–2025 | *in progress* | Wayback | Scraper currently running |
| 2026 | 141 | Live site | Current festival year |

### Database Statistics (latest rebuild)

| Metric | Value |
|:---|---:|
| Audio records | 974 |
| Score records | 601 |
| Video records | 41 |
| Scraped programme concerts | 1,280 |
| Unique concert events resolved | 632 |
| Concerts linked to programme data | 167 |
| Video↔Audio matches | 12 |
| Audio bridged to scores | 260 (26.7%) |
| Theoretical concert↔score bridges | 20,264 |

---

## Key Design Decisions

### 1. Isolation Principle
All derived data lives in `Project Space/Verbier/inventory/`. The source `Datasets/` directory on the NAS is strictly read-only and never modified.

### 2. Event-Centric Schema
The database uses concerts as the central entity, enabling many-to-many relationships: one concert can feature multiple composers and link to multiple scores; one score can appear in multiple concerts.

### 3. Media String Fallback
Since the Internet Archive has zero structured programme data for 1994–1996, 1998–1999, we implemented a local heuristic: scanning video description strings and audio folder names against a curated composer whitelist (`Beethoven`, `Mozart`, `Brahms`, `Haydn`, etc.) to extract composer associations directly from the physical file metadata. This single technique rescued **93 audio records** (~35% of all bridged links) that would otherwise have remained completely unlinked.

### 4. Normalized Composer Names
All composer names pass through a `normalize_composer()` function that strips diacritics, standardizes casing, and resolves common variants (e.g., `Dvořák` / `Dvorak` → `dvorak`).

---

## How to Run

### Prerequisites
- Python 3.10+
- `pip install requests beautifulsoup4 openpyxl`

### Full Pipeline (from scratch)
```bash
cd "/Volumes/EMPLUS-Students/CDS 2026/Project Space/Verbier"

# 1. Extract metadata from Excel spreadsheets
python3 inventory/scripts/extraction/score_audio_linkage_analysis.py
python3 inventory/scripts/extraction/parse_video_metadata.py

# 2. Scrape historical programmes (takes ~2 hours for all years)
python3 inventory/scripts/extraction/verbier_programme_scraper.py --all --historical

# 3. Build the reconciliation database
python3 inventory/scripts/reconciliation/build_reconciliation_db.py
```

### Just rebuild the database (after new programme data arrives)
```bash
python3 inventory/scripts/reconciliation/build_reconciliation_db.py
```

---

## Known Limitations

1. **Missing Early Years (1994–1996, 1998–1999):** No programme data exists on the Wayback Machine for these years. The Media String Fallback provides partial coverage, but only for recordings that have descriptive folder/file names.

2. **Video Coverage:** Only 41 DVD recordings exist in the dataset, and only 12 could be matched to corresponding audio files. This is a data availability limitation, not a pipeline issue.

3. **Duplicate Programme Entries:** Some years (especially 2004, 2007) have high concert counts because the scraper captures multilingual variants (EN/FR/DE) of the same concert. The reconciler deduplicates by `(date, venue_code)`, but some noise may persist.

4. **Score Bridging is Composer-Level:** The current bridge connects scores to concerts based on composer name only — it does not yet resolve to specific works (e.g., "Beethoven Sonata No. 5" vs "Beethoven Symphony No. 9").

---

## Next Steps

- [ ] Complete programme scraping for 2013–2025 (currently in progress)
- [ ] Rebuild `verbier_archive.sqlite` with complete programme data
- [ ] Implement work-level matching (beyond composer-level) using title fuzzy matching
- [ ] Connect `video_audio_matches.json` to the current follow-the-conductor gallery/video view
- [ ] Build a SQLite-backed API for the curator frontend to query the archive dynamically

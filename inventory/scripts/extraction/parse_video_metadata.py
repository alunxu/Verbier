#!/usr/bin/env python3
import pandas as pd
import json
import re
from pathlib import Path

WORKSPACE = Path("/Volumes/EMPLUS-Students/CDS 2026/Project Space/Verbier")
DVD_EXCEL_PATH = Path("/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/Audio/Numérisations/DVD/vf_audio_inventaire_AS_DVD Only.xlsx")
OUTPUT_JSON = WORKSPACE / "inventory" / "overview" / "metadata" / "parsed_video_metadata.json"

VENUE_MAP = {
    'M': 'medran',
    'E': 'eglise',
    'C': 'cinema',
    'H': 'hameau',
    'X': 'unknown'
}

def parse_recording_key(key: str) -> dict:
    """Parse the Verbier numérisation string (e.g. M030722XXA11VD)"""
    # Regex for standard 14-char key: M|E|C|X + YY + MMDD + HH/XX + A-Z + 00… + VD
    # M 03 0722 XX A 11 VD
    
    match = re.search(r'^([A-Z])(\d{2})(\d{4}|XXXX)([0-9]{2}|XX)([A-Z])(\d{2})(VD|CC|DT|CD)', key)
    if not match:
        return {}
        
    venue_char, yy, mmdd, hh, side, copy, format_code = match.groups()
    
    year_prefix = "19" if int(yy) > 90 else "20"
    year = int(f"{year_prefix}{yy}")
    
    date_str = None
    month, day = None, None
    if mmdd != "XXXX":
        month = int(mmdd[:2])
        day = int(mmdd[2:])
        date_str = f"{year}-{month:02d}-{day:02d}"
        
    time_str = f"{hh}:00" if hh != "XX" else None
    
    return {
        "folder_name": key,
        "venue_code": VENUE_MAP.get(venue_char, "unknown"),
        "year": year,
        "date": date_str,
        "time": time_str,
        "media_type": format_code
    }

def main():
    if not DVD_EXCEL_PATH.exists():
        print(f"Error: {DVD_EXCEL_PATH} not found.")
        return

    print(f"Reading {DVD_EXCEL_PATH.name}...")
    df = pd.read_excel(DVD_EXCEL_PATH)
    
    # Fill nan with empty string
    df = df.fillna("")
    
    parsed_videos = []
    
    for idx, row in df.iterrows():
        key = str(row.get("recording_key", ""))
        title = str(row.get("media_file_name", ""))
        venue = str(row.get("event_place", ""))
        
        if not key: continue
        
        meta = parse_recording_key(key)
        if not meta:
            meta = {
                "folder_name": key,
                "venue_code": "unknown",
                "year": None, "date": None, "time": None, "media_type": "VD"
            }
            
        # Enrich from spreadsheet
        meta["description"] = title
        meta["venue_name_sheet"] = venue
        
        parsed_videos.append(meta)
        
    # Save to JSON
    with open(OUTPUT_JSON, "w") as f:
        json.dump(parsed_videos, f, indent=2)
        
    print(f"Parsed {len(parsed_videos)} video/DVD records.")
    print(f"Saved to {OUTPUT_JSON}")

if __name__ == "__main__":
    main()

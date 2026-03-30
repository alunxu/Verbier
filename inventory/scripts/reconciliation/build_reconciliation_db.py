#!/usr/bin/env python3
import json
import sqlite3
import glob
import re
from pathlib import Path

# Paths
WORKSPACE = Path("/Volumes/EMPLUS-Students/CDS 2026/Project Space/Verbier")
AUDIO_FILE = WORKSPACE / "inventory" / "overview" / "metadata" / "parsed_audio_metadata.json"
SCORE_FILE = WORKSPACE / "inventory" / "overview" / "metadata" / "parsed_score_metadata.json"
VIDEO_FILE = WORKSPACE / "inventory" / "overview" / "metadata" / "parsed_video_metadata.json"
PROGRAMME_DIR = WORKSPACE / "inventory" / "programme_data"
DB_FILE = WORKSPACE / "verbier_archive.sqlite"

def setup_database(conn):
    c = conn.cursor()
    c.executescript('''
        DROP TABLE IF EXISTS concert_scores_link;
        DROP TABLE IF EXISTS concert_composers;
        DROP TABLE IF EXISTS printed_scores;
        DROP TABLE IF EXISTS video_recordings;
        DROP TABLE IF EXISTS audio_recordings;
        DROP TABLE IF EXISTS concerts;

        CREATE TABLE concerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            time TEXT,
            title TEXT,
            venue TEXT,
            event_type TEXT,
            source TEXT
        );

        CREATE TABLE audio_recordings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            concert_id INTEGER REFERENCES concerts(id),
            folder_name TEXT,
            date TEXT,
            time TEXT,
            venue_code TEXT,
            venue_name TEXT,
            track_count INTEGER,
            full_path TEXT
        );

        CREATE TABLE video_recordings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            concert_id INTEGER REFERENCES concerts(id),
            folder_name TEXT,
            date TEXT,
            time TEXT,
            venue_code TEXT,
            venue_name_sheet TEXT,
            media_type TEXT,
            description TEXT
        );

        CREATE TABLE printed_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            composer TEXT,
            work_folder TEXT,
            edition_folder TEXT,
            edition_type TEXT,
            pdf_count INTEGER,
            full_path TEXT
        );

        CREATE TABLE concert_composers (
            concert_id INTEGER REFERENCES concerts(id),
            composer_name TEXT,
            UNIQUE(concert_id, composer_name)
        );

        CREATE TABLE concert_scores_link (
            concert_id INTEGER REFERENCES concerts(id),
            score_id INTEGER REFERENCES printed_scores(id),
            matched_by TEXT,
            UNIQUE(concert_id, score_id)
        );
    ''')
    conn.commit()

def load_data():
    audio = []
    if AUDIO_FILE.exists():
        with open(AUDIO_FILE, 'r') as f:
            audio = json.load(f)
            
    scores = []
    if SCORE_FILE.exists():
        with open(SCORE_FILE, 'r') as f:
            scores = json.load(f)
            
    programmes = []
    # Load all generated year programmes
    for p_file in PROGRAMME_DIR.glob("*_programme.json"):
        with open(p_file, 'r') as f:
            try:
                data = json.load(f)
                programmes.extend(data)
            except:
                pass
                
    videos = []
    if VIDEO_FILE.exists():
        with open(VIDEO_FILE, 'r') as f:
            videos = json.load(f)
            
    return audio, scores, programmes, videos

def normalize_composer(name):
    """Normalize composer names for fuzzy matching."""
    if not name: return ""
    name = name.upper().strip()
    # Handle common variations
    variants = {
        "DVOŘÁK": "DVORAK",
        "BEETHOVEN": "BEETHOVEN",
        "MOZART": "MOZART",
        "TCHAIKOVSKY": "TCHAIKOVSKY"
    }
    return variants.get(name, name)

def build_reconciliation(conn, audio_data, score_data, programme_data, video_data):
    c = conn.cursor()
    
    # 1. Insert all physical printed scores
    print(f"Loading {len(score_data)} scores into DB...")
    score_id_map = {} # full_path -> id
    for s in score_data:
        c.execute('''
            INSERT INTO printed_scores (composer, work_folder, edition_folder, edition_type, pdf_count, full_path)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (s.get("composer"), s.get("work_folder"), s.get("edition_folder"), s.get("edition_type"), s.get("pdf_count"), s.get("full_path")))
        score_id_map[s.get("full_path")] = c.lastrowid
        
    print(f"Loading {len(programme_data)} scraped programme concerts...")
    # Index programme data by date: { "YYYY-MM-DD": [concert_dict, ...] }
    prog_by_date = {}
    for p in programme_data:
        d = p.get("date")
        if d:
            if d not in prog_by_date:
                prog_by_date[d] = []
            prog_by_date[d].append(p)

    # 2. Iterate through Audio. 
    # An Audio recording *is* a physical Concert Event.
    # If a scraped programme exists for that date, merge its metadata into the Concert Event.
    print(f"Loading {len(audio_data)} audio recordings and resolving Concert events...")
    
    # Track daily concerts to avoid creating duplicate physical events for the same timestamp/venue
    date_venue_to_concert_id = {}
    
    linked_concerts = 0

    for a in audio_data:
        date = a.get("date")
        time = a.get("time")
        venue_code = a.get("venue_code")
        
        # Check if we already created a concert for this Date+Time+Venue
        event_key = f"{date}_{time}_{venue_code}"
        concert_id = date_venue_to_concert_id.get(event_key)
        
        if not concert_id:
            # We need to create a new Concert row
            # Try to enrich it with Programme data!
            p_matches = prog_by_date.get(date, [])
            
            p_title = f"Unknown Concert {date}"
            p_event_type = "unknown"
            p_composers = []
            source = "audio_only"
            
            # If there's programme data for that day, we naively bucket everything on that day into this event
            # (In a perfect world we'd match exact `time`, but historically that's tricky).
            if p_matches:
                source = "audio+programme"
                # Combine metadata from all programmes on that date
                titles = []
                for match in p_matches:
                    if match.get("title"): titles.append(match["title"])
                    if match.get("composers"): p_composers.extend(match["composers"])
                
                if titles:
                    p_title = " / ".join(set(titles))
                p_event_type = "concert"
                linked_concerts += 1
                
            c.execute('''
                INSERT INTO concerts (date, time, title, venue, event_type, source)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (date, time, p_title, a.get("venue_name"), p_event_type, source))
            
            concert_id = c.lastrowid
            date_venue_to_concert_id[event_key] = concert_id
            
            # Map composers to event
            for comp in set(p_composers):
                norm_comp = normalize_composer(comp)
                if norm_comp:
                    c.execute('''
                        INSERT OR IGNORE INTO concert_composers (concert_id, composer_name)
                        VALUES (?, ?)
                    ''', (concert_id, norm_comp))
                    
            # --- AUDIO MEDIA STRING FALLBACK ---
            if not p_composers:
                search_str = f"{a.get('folder_name', '')} {a.get('full_path', '')}"
                for comp in ["Beethoven", "Mozart", "Brahms", "Haydn", "Schubert", "Dvořák", "Dvorak", "Corelli", "Mendelssohn", "Bach", "Chopin", "Liszt", "Rachmaninoff", "Tchaikovsky", "Shostakovich", "Prokofiev", "Schumann", "Mahler"]:
                    if comp.lower() in search_str.lower():
                        c.execute('''INSERT OR IGNORE INTO concert_composers (concert_id, composer_name) VALUES (?, ?)''', (concert_id, normalize_composer(comp)))
            # -----------------------------------
        
        # Insert Audio Recording
        c.execute('''
            INSERT INTO audio_recordings (concert_id, folder_name, date, time, venue_code, venue_name, track_count, full_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (concert_id, a.get("folder_name"), date, time, venue_code, a.get("venue_name"), a.get("track_count"), a.get("full_path")))

    # 2.5 Iterate through Videos
    linked_videos = 0
    for v in video_data:
        date = v.get("date")
        time = v.get("time")
        venue_code = v.get("venue_code")
        
        event_key = f"{date}_{time}_{venue_code}"
        concert_id = date_venue_to_concert_id.get(event_key)
        
        # Fuzzy Match: If we don't have an exact time match (e.g., DVD says 'XX'), 
        # try to find ANY audio recording on that date + venue_code.
        if not concert_id and not time:
            c.execute('SELECT concert_id FROM audio_recordings WHERE date = ? AND venue_code = ? LIMIT 1', (date, venue_code))
            row = c.fetchone()
            if row:
                concert_id = row[0]
                
        if not concert_id:
            # We don't have an audio recording for this video. Create an orphaned concert node
            c.execute('''INSERT INTO concerts (date, time, venue, event_type, source) VALUES (?, ?, ?, ?, ?)''', (date, time, venue_code, "concert", "video_only"))
            concert_id = c.lastrowid
            date_venue_to_concert_id[event_key] = concert_id
        else:
            linked_videos += 1
            
        c.execute('''
            INSERT INTO video_recordings (concert_id, folder_name, date, time, venue_code, venue_name_sheet, media_type, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (concert_id, v.get("folder_name"), date, time, venue_code, v.get("venue_name_sheet"), v.get("media_type"), v.get("description")))

        # --- VIDEO MEDIA STRING FALLBACK ---
        desc = v.get("description", "")
        if desc:
            for comp in ["Beethoven", "Mozart", "Brahms", "Haydn", "Schubert", "Dvořák", "Dvorak", "Corelli", "Mendelssohn", "Bach", "Chopin", "Liszt", "Rachmaninoff", "Tchaikovsky", "Shostakovich", "Prokofiev", "Schumann", "Mahler"]:
                if comp.lower() in desc.lower():
                    c.execute('''INSERT OR IGNORE INTO concert_composers (concert_id, composer_name) VALUES (?, ?)''', (concert_id, normalize_composer(comp)))
        # -----------------------------------

    print(f"Generated {len(date_venue_to_concert_id)} unique physical Concert events. ({linked_concerts} linked to Programme archives, {linked_videos} matched to existing Audio)")

    # 3. Concert -> Score Linkage (The Final Bridge)
    # If a Concert featured BEETHOVEN, find all BEETHOVEN scores and link them to the Concert.
    print("Reconciling physical scores to Concert events...")
    c.execute('SELECT concert_id, composer_name FROM concert_composers')
    concert_comps = c.fetchall()
    
    bridges_made = 0
    for concert_id, comp_name in concert_comps:
        # Find all scores matching this composer (loose matching)
        c.execute('SELECT id, composer, edition_folder FROM printed_scores WHERE upper(composer) LIKE ?', (f'%{comp_name}%',))
        matching_scores = c.fetchall()
        for score_id, s_comp, s_edit in matching_scores:
            # Rigorous Matching rules applied here
            c.execute('SELECT date FROM concerts WHERE id = ?', (concert_id,))
            c_date = c.fetchone()[0]
            c_year = c_date[:4] if c_date else ""
            
            s_edit = str(s_edit)
            
            # 1. Does the score explicitly assert a different year? (e.g. 2011 Concert vs "VF 2018" score)
            # Find any 4-digit year in the score edition folder
            ext_year_matches = re.findall(r'\b(19\d{2}|20\d{2})\b', s_edit)
            
            matched_by = None
            if ext_year_matches:
                if c_year in ext_year_matches:
                    matched_by = "strong_year_match"
                else:
                    # The score asserts a year, but it is NOT the year of this concert. Reject!
                    continue
            else:
                # 2. No year explicitly stated but composer matches. (Validated Weak Match)
                matched_by = "validated_weak_match"
                
            c.execute('''
                INSERT OR IGNORE INTO concert_scores_link (concert_id, score_id, matched_by)
                VALUES (?, ?, ?)
            ''', (concert_id, score_id, matched_by))
            bridges_made += 1
            
    print(f"Established {bridges_made} theoretical Concert <-> Score bridges.")
    conn.commit()
    
    # Generate quick stats
    c.execute('SELECT count(*) FROM audio_recordings')
    total_audio = c.fetchone()[0]
    c.execute('SELECT count(DISTINCT a.id) FROM audio_recordings a JOIN concerts c ON a.concert_id=c.id WHERE c.source="audio+programme"')
    bridged_audio = c.fetchone()[0]
    
    # Generate quick stats
    c.execute('SELECT count(*) FROM audio_recordings')
    total_a = c.fetchone()[0]
    c.execute('SELECT count(DISTINCT a.id) FROM audio_recordings a JOIN concerts c ON a.concert_id=c.id WHERE c.source="audio+programme"')
    bridged_a = c.fetchone()[0]
    
    # 4. Export Video <-> Audio Matches
    print("Exporting video_audio_matches.json for the curator app...")
    c_cursor = conn.cursor()
    c_cursor.execute('''
        SELECT 
            c.date, c.venue,
            v.folder_name as video_folder, v.description,
            a.folder_name as audio_folder, a.full_path
        FROM video_recordings v
        JOIN audio_recordings a ON v.concert_id = a.concert_id
        JOIN concerts c ON v.concert_id = c.id
    ''')
    matches = c_cursor.fetchall()
    
    match_list = []
    for m in matches:
        match_list.append({
            "concert_date": m[0],
            "venue": m[1],
            "video_folder": m[2],
            "video_description": m[3],
            "audio_folder": m[4],
            "audio_path": m[5]
        })
        
    export_path = WORKSPACE / "inventory" / "overview" / "video_audio_matches.json"
    with open(export_path, "w") as f:
        json.dump(match_list, f, indent=2)
        
    print(f"Exported {len(match_list)} matched video/audio bridges.")
    
    return total_a, bridged_a

def main():
    print(f"--- Verbier Database Builder ---")
    audio, scores, programmes, videos = load_data()
    
    if DB_FILE.exists():
        DB_FILE.unlink()
        
    conn = sqlite3.connect(DB_FILE)
    setup_database(conn)
    total_a, bridged_a = build_reconciliation(conn, audio, scores, programmes, videos)
    conn.close()
    
    print("--- Summary ---")
    print(f"Audio Records Extracted: {total_a}")
    print(f"Scores Extracted: {len(scores)}")
    print(f"Historical Concerts Scraped: {len(programmes)}")
    percent = round((bridged_a/total_a*100) if total_a > 0 else 0, 1)
    print(f"Bridged Audio (Linked to Score/Programme): {bridged_a} ({percent}%)")
    print(f"\nDatabase fully reconciled and saved to {DB_FILE}")

if __name__ == '__main__':
    main()

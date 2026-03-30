#!/usr/bin/env python3
"""
render_dcml_stems.py — Render chamber music stems from DCML corpora

Parses MSCX files directly via XML (no ms3 dependency needed), extracts
per-staff note data, creates per-instrument MIDI files via pretty_midi,
and renders audio via FluidSynth.

Selected corpora (chamber / multi-instrument only):
  - ABC: Beethoven string quartets (vn1, vn2, va, vc)
  - corelli: Trio sonatas (vn1, vn2, continuo)
  - mendelssohn_quartets: String quartets (vn1, vn2, va, vc)

Usage:
    python3 scripts/render_dcml_stems.py
    python3 scripts/render_dcml_stems.py --max-pieces 3

Requirements:
    pip install pretty_midi
    brew install fluid-synth ffmpeg
"""

import json
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths — temp work on local SSD, finals on NAS
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
ASSETS_DIR = PROJECT_DIR / "assets"
AUDIO_DIR = ASSETS_DIR / "audio"
STEMS_DIR = ASSETS_DIR / "stems"
MANIFEST_DIR = ASSETS_DIR / "manifests"
TMP_DIR = Path("/tmp/verbier_dcml_repos")
MIDI_DIR = Path("/tmp/verbier_dcml_midi")


# ---------------------------------------------------------------------------
# DCML repos (chamber music only)
# ---------------------------------------------------------------------------
DCML_REPOS = [
    {
        "name": "ABC",
        "url": "https://github.com/DCMLab/ABC.git",
        "composer": "Ludwig van Beethoven",
        "description": "Beethoven String Quartets",
        "genre": "chamber",
        "ensemble": "String Quartet",
    },
    {
        "name": "corelli",
        "url": "https://github.com/DCMLab/corelli.git",
        "composer": "Arcangelo Corelli",
        "description": "Corelli Trio Sonatas",
        "genre": "baroque",
        "ensemble": "Trio Sonata",
    },
    {
        "name": "mendelssohn_quartets",
        "url": "https://github.com/DCMLab/mendelssohn_quartets.git",
        "composer": "Felix Mendelssohn",
        "description": "Mendelssohn String Quartets",
        "genre": "chamber",
        "ensemble": "String Quartet",
    },
]

# GM programs
GM_PROGRAMS = {
    "violin": 40, "violin i": 40, "violin ii": 40,
    "viola": 41, "cello": 42, "violoncello": 42,
    "violoncello e contrabasso": 42,
    "violone e cembalo": 6, "basso continuo": 6, "continuo": 6,
    "flute": 73, "oboe": 68, "clarinet": 71, "bassoon": 70,
    "horn": 60, "trumpet": 56, "trombone": 57,
    "piano": 0, "harpsichord": 6, "cembalo": 6, "organo": 19,
}

NORM_NAMES = {
    "violin i": "violin1", "violin ii": "violin2",
    "violino i": "violin1", "violino ii": "violin2",
    "viola": "viola", "violoncello": "cello", "cello": "cello",
    "violoncello e contrabasso": "cello",
    "violone e cembalo": "continuo", "basso continuo": "continuo",
    "continuo": "continuo", "organo": "organ",
}


# ═══════════════════════════════════════════════════════════════════════════
# MSCX XML Parser — extracts per-staff MIDI notes directly
# ═══════════════════════════════════════════════════════════════════════════

def parse_pitch(note_el):
    """Convert a MuseScore <Note> element to MIDI pitch."""
    pitch_el = note_el.find("pitch")
    if pitch_el is not None:
        return int(pitch_el.text)
    # Fallback: compute from tpc + octave
    return None


def parse_duration_type(dtype):
    """Map MuseScore duration type name to fraction of a whole note."""
    mapping = {
        "whole": Fraction(1),
        "half": Fraction(1, 2),
        "quarter": Fraction(1, 4),
        "eighth": Fraction(1, 8),
        "16th": Fraction(1, 16),
        "32nd": Fraction(1, 32),
        "64th": Fraction(1, 64),
        "128th": Fraction(1, 128),
        "breve": Fraction(2),
        "longa": Fraction(4),
    }
    return mapping.get(dtype, Fraction(1, 4))


def apply_dots(dur, n_dots):
    """Apply dotted note augmentation."""
    total = dur
    addition = dur
    for _ in range(n_dots):
        addition = addition / 2
        total += addition
    return total


def parse_mscx_parts(mscx_path):
    """Parse an MSCX file and return part info."""
    tree = ET.parse(str(mscx_path))
    root = tree.getroot()
    score = root.find("Score")
    if score is None:
        score = root

    parts_info = {}
    for part in score.findall("Part"):
        staff_el = part.find("Staff")
        if staff_el is None:
            continue
        sid = staff_el.attrib.get("id")
        instr = part.find("Instrument")
        name = "unknown"
        if instr is not None:
            for tag in ["longName", "trackName"]:
                el = instr.find(tag)
                if el is not None and el.text:
                    name = el.text.strip()
                    break
        if sid:
            parts_info[int(sid)] = name

    return score, parts_info


def extract_notes_for_staff(score, staff_id):
    """Extract all notes from a specific staff as (onset_beats, duration_beats, midi_pitch)."""
    notes = []

    # Find the Staff element with matching id (the second set — the content staves)
    content_staves = [
        s for s in score.findall("Staff")
        if s.attrib.get("id") == str(staff_id) and s.find("Measure") is not None
    ]
    if not content_staves:
        return notes

    staff = content_staves[0]
    current_time = Fraction(0)  # in quarter notes

    for measure in staff.findall("Measure"):
        voice_el = measure.find("voice")
        if voice_el is None:
            # Try direct children
            elements = list(measure)
        else:
            elements = list(voice_el)

        measure_time = current_time

        for elem in elements:
            tag = elem.tag
            if tag == "Chord":
                # Get duration
                dur_type_el = elem.find("durationType")
                dur_type = dur_type_el.text if dur_type_el is not None else "quarter"
                dur_frac = parse_duration_type(dur_type)

                # Check for dots
                dots_el = elem.find("dots")
                n_dots = int(dots_el.text) if dots_el is not None else 0
                if n_dots > 0:
                    dur_frac = apply_dots(dur_frac, n_dots)

                # Convert whole-note fraction to quarter-note beats
                dur_beats = float(dur_frac * 4)

                # Extract notes
                for note_el in elem.findall("Note"):
                    pitch = parse_pitch(note_el)
                    if pitch is not None and 21 <= pitch <= 108:
                        notes.append((float(measure_time), dur_beats, pitch))

                measure_time += Fraction(dur_frac * 4)

            elif tag == "Rest":
                dur_type_el = elem.find("durationType")
                dur_type = dur_type_el.text if dur_type_el is not None else "quarter"
                dur_frac = parse_duration_type(dur_type)

                dots_el = elem.find("dots")
                n_dots = int(dots_el.text) if dots_el is not None else 0
                if n_dots > 0:
                    dur_frac = apply_dots(dur_frac, n_dots)

                measure_time += Fraction(dur_frac * 4)

        # Advance by the actual time signature's measure length
        # (fallback: use whatever we accumulated)
        if measure_time > current_time:
            current_time = measure_time
        else:
            current_time += Fraction(4)  # default 4/4

    return notes


# ═══════════════════════════════════════════════════════════════════════════
# Audio Pipeline
# ═══════════════════════════════════════════════════════════════════════════

def find_soundfont():
    """Find a usable SoundFont (optional, for better quality)."""
    candidates = [
        Path("/opt/homebrew/Cellar/fluid-synth/2.5.3/share/fluid-synth/sf2/VintageDreamsWaves-v2.sf2"),
    ]
    try:
        result = subprocess.run(
            ["find", "/opt/homebrew", "-name", "*.sf2", "-size", "+100k"],
            capture_output=True, text=True, timeout=5)
        for line in result.stdout.strip().split("\n"):
            if line.strip():
                candidates.append(Path(line.strip()))
    except:
        pass
    for p in candidates:
        if p.exists() and p.stat().st_size > 10000:
            return p
    return None


def notes_to_midi(notes_list, instrument_name, tempo_bpm=108):
    """Convert note list to pretty_midi object."""
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(initial_tempo=tempo_bpm)

    inst_lower = instrument_name.lower().strip()
    program = 0
    for key, val in GM_PROGRAMS.items():
        if key in inst_lower or inst_lower in key:
            program = val
            break

    instrument = pretty_midi.Instrument(program=program, name=instrument_name)
    beat_dur = 60.0 / tempo_bpm

    for onset_beats, dur_beats, pitch in notes_list:
        start = onset_beats * beat_dur
        end = start + dur_beats * beat_dur
        if end <= start:
            end = start + 0.05
        note = pretty_midi.Note(velocity=80, pitch=pitch, start=start, end=end)
        instrument.notes.append(note)

    if len(instrument.notes) == 0:
        return None
    pm.instruments.append(instrument)
    return pm


def render_midi_to_wav(midi_path, wav_path, sf_path=None):
    """Render MIDI to WAV using pretty_midi synthesis."""
    try:
        import pretty_midi
        import soundfile as sf_lib

        pm = pretty_midi.PrettyMIDI(str(midi_path))

        # Try FluidSynth if pyfluidsynth is available and we have a soundfont
        audio = None
        if sf_path is not None:
            try:
                audio = pm.fluidsynth(fs=22050, sf2_path=str(sf_path))
            except Exception:
                pass

        # Fallback to basic synthesis (sine waves — still sounds decent)
        if audio is None:
            audio = pm.synthesize(fs=22050)

        if audio is not None and len(audio) > 0:
            # Normalize to prevent clipping
            peak = max(abs(audio.max()), abs(audio.min()), 1e-6)
            audio = audio / peak * 0.8
            sf_lib.write(str(wav_path), audio, 22050)
            return wav_path.exists() and wav_path.stat().st_size > 1000
        return False
    except Exception as e:
        print(f"    Render error: {e}")
        return False


def wav_to_ogg(wav_path, ogg_path):
    """Convert WAV to OGG."""
    try:
        # Try vorbis encoder (built-in, vs libvorbis which may not be installed)
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path), "-ac", "2",
             "-c:a", "vorbis", "-q:a", "5", "-strict", "-2", str(ogg_path)],
            capture_output=True, check=True, timeout=60)
        return ogg_path.exists()
    except subprocess.CalledProcessError:
        # Fallback: try libvorbis
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(wav_path),
                 "-c:a", "libvorbis", "-q:a", "5", str(ogg_path)],
                capture_output=True, check=True, timeout=60)
            return ogg_path.exists()
        except:
            pass
    except:
        pass
    return False


def mix_stems(stem_wavs, mix_path):
    """Mix stems via ffmpeg."""
    if not stem_wavs:
        return False
    if len(stem_wavs) == 1:
        shutil.copy2(str(stem_wavs[0]), str(mix_path))
        return True
    inputs = []
    filter_parts = []
    for j, wav in enumerate(stem_wavs):
        inputs.extend(["-i", str(wav)])
        filter_parts.append(f"[{j}:a]")
    filter_str = "".join(filter_parts) + f"amix=inputs={len(stem_wavs)}:duration=longest[out]"
    try:
        subprocess.run(
            ["ffmpeg", "-y"] + inputs +
            ["-filter_complex", filter_str, "-map", "[out]",
             "-ac", "2", "-ar", "22050", str(mix_path)],
            capture_output=True, check=True, timeout=120)
        return mix_path.exists()
    except Exception as e:
        print(f"    Mix error: {e}")
        return False


def normalize_name(raw_name, idx, total):
    """Normalize instrument name."""
    name = raw_name.lower().strip().rstrip('.')
    # Explicit mappings — sorted longest-first for correct substring matching
    norm = {
        "violoncello e contrabasso": "cello",
        "violone e cembalo": "continuo",
        "basso continuo": "continuo",
        "stringinstrument": "strings",
        "1st violin": "violin1",
        "2nd violin": "violin2",
        "violino ii": "violin2",
        "violino i": "violin1",
        "violin ii": "violin2",
        "violin i": "violin1",
        "violin 2": "violin2",
        "violin 1": "violin1",
        "violoncello": "cello",
        "viola": "viola",
        "cello": "cello",
        "violin": "violin",
        "continuo": "continuo",
        "keyboard": "keyboard",
        "organo": "organ",
    }
    for pattern, replacement in norm.items():
        if name == pattern or pattern in name:
            return replacement
    # Generic string quartet layout
    if total == 4 and ("part" in name or name == "unknown"):
        return ["violin1", "violin2", "viola", "cello"][min(idx, 3)]
    # Fallback: clean up
    return name.replace(" ", "_")[:20]


# ═══════════════════════════════════════════════════════════════════════════
# Main pipeline
# ═══════════════════════════════════════════════════════════════════════════

def clone_repos():
    """Clone repos to local /tmp."""
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    for repo in DCML_REPOS:
        repo_dir = TMP_DIR / repo["name"]
        if repo_dir.exists() and (repo_dir / "MS3").exists():
            print(f"  {repo['name']} already cloned ✓")
            continue
        if repo_dir.exists():
            shutil.rmtree(repo_dir)
        print(f"  Cloning {repo['name']}...")
        subprocess.run(
            ["git", "clone", "--depth", "1", repo["url"], str(repo_dir)],
            check=True, capture_output=True)
        print(f"  {repo['name']} ✓")


def process_piece(mscx_path, piece_id, repo_info, sf_path, max_dur_sec=60):
    """Process one MSCX → stems + mix."""
    print(f"\n--- [{piece_id}] {mscx_path.name} ---")

    # Parse
    score, parts = parse_mscx_parts(mscx_path)
    if len(parts) < 2:
        print(f"    Skip: only {len(parts)} part(s)")
        return None

    print(f"    Parts: {list(parts.values())}")

    MIDI_DIR.mkdir(parents=True, exist_ok=True)
    STEMS_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    instruments = []
    stem_wavs = []

    for idx, (sid, raw_name) in enumerate(sorted(parts.items())):
        inst = normalize_name(raw_name, idx, len(parts))
        # Handle duplicate instrument names properly (e.g., 2 violins → violin1, violin2)
        if inst in instruments:
            count = sum(1 for x in instruments if x.startswith(inst))
            inst = f"{inst}{count + 1}" if not inst[-1].isdigit() else f"{inst}_{count + 1}"
        instruments.append(inst)

        # Extract notes
        notes = extract_notes_for_staff(score, sid)
        if len(notes) < 5:
            print(f"    {inst}: only {len(notes)} notes, skipping")
            continue

        # Create MIDI
        pm = notes_to_midi(notes, raw_name, tempo_bpm=108)
        if pm is None:
            continue

        # Trim to max duration
        total_dur = pm.get_end_time()
        if total_dur > max_dur_sec:
            for instr in pm.instruments:
                instr.notes = [n for n in instr.notes if n.start < max_dur_sec]
                for n in instr.notes:
                    if n.end > max_dur_sec:
                        n.end = max_dur_sec

        midi_path = MIDI_DIR / f"{piece_id}_{inst}.mid"
        pm.write(str(midi_path))

        # Render WAV
        wav_path = MIDI_DIR / f"{piece_id}_{inst}.wav"  # temp WAV in /tmp
        if render_midi_to_wav(midi_path, wav_path, sf_path):
            # Convert to OGG on NAS
            ogg_path = STEMS_DIR / f"{piece_id}_{inst}.ogg"
            if wav_to_ogg(wav_path, ogg_path):
                stem_wavs.append(wav_path)
                print(f"    ✓ {inst} ({len(notes)} notes, {total_dur:.0f}s)")
            else:
                print(f"    ✗ {inst}: ogg conversion failed")
        else:
            print(f"    ✗ {inst}: render failed")

    if len(stem_wavs) < 2:
        print(f"    Skip: only {len(stem_wavs)} stems rendered")
        return None

    # Mix — use WAV (ffmpeg's vorbis encoder is buggy in this version)
    mix_wav = MIDI_DIR / f"{piece_id}_mix.wav"
    mix_out = AUDIO_DIR / f"{piece_id}_mix.wav"
    if mix_stems(stem_wavs, mix_wav):
        shutil.copy2(str(mix_wav), str(mix_out))
        print(f"    ✓ Mix: {len(stem_wavs)} stems")

    # Build stems dict
    stems_dict = {}
    for inst in instruments:
        ogg = STEMS_DIR / f"{piece_id}_{inst}.ogg"
        if ogg.exists():
            stems_dict[inst] = f"assets/stems/{piece_id}_{inst}.ogg"

    title = mscx_path.stem.replace("_", " ").replace("-", " ")

    return {
        "id": piece_id,
        "title": title,
        "composer": repo_info["composer"],
        "ensemble": repo_info["ensemble"],
        "genre": repo_info["genre"],
        "instrumentation": [i for i in instruments if i in stems_dict],
        "audio_url": f"assets/audio/{piece_id}_mix.wav",
        "stems": stems_dict,
        "video_url": None,
        "features_timeseries_url": f"assets/features/{piece_id}_mix_features.json",
        "preview_excerpt": {"start_sec": 5, "end_sec": 20},
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Render DCML chamber stems")
    parser.add_argument("--max-pieces", type=int, default=1,
                        help="Pieces per corpus (default: 1 = 3 total)")
    parser.add_argument("--max-duration", type=int, default=60,
                        help="Max duration in seconds (default: 60)")
    args = parser.parse_args()

    print("\n=== Verbier — DCML Chamber Music Renderer ===\n")

    # SoundFont (optional — improves quality)
    print("1. Checking SoundFont (optional)...")
    sf = find_soundfont()
    if sf:
        print(f"  Using: {sf}")
    else:
        print("  No SoundFont found — using basic synthesis (install pyfluidsynth for better quality)")

    # Clone
    print("\n2. Cloning DCML corpora (to /tmp for speed)...")
    clone_repos()

    # Process
    print(f"\n3. Processing ({args.max_pieces} per corpus)...")
    performances = []
    counter = 1

    for repo in DCML_REPOS:
        ms3_dir = TMP_DIR / repo["name"] / "MS3"
        if not ms3_dir.exists():
            print(f"  {repo['name']}: MS3 dir not found, skipping")
            continue
        scores = sorted(ms3_dir.glob("*.mscx"))
        print(f"\n  === {repo['description']} ({len(scores)} files) ===")

        done = 0
        for mscx in scores:
            if done >= args.max_pieces:
                break
            pid = f"dcml_{counter:02d}"
            result = process_piece(mscx, pid, repo, sf, args.max_duration)
            if result:
                performances.append(result)
                done += 1
                counter += 1

    # Manifest
    print(f"\n4. Saving manifest ({len(performances)} performances)...")
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST_DIR / "performances.json", "w") as f:
        json.dump(performances, f, indent=2)

    print(f"\n✅ Done! {len(performances)} pieces rendered.\n")
    print("Next: npm run dev")


if __name__ == "__main__":
    main()

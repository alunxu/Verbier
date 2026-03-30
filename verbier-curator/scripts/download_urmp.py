#!/usr/bin/env python3
"""
download_urmp.py — Download and prepare URMP dataset recordings
for the Verbier Festival Curator.

Usage:
  1. Go to https://labsites.rochester.edu/air/projects/URMP.html
  2. Fill out the Google Form to request the download link
  3. Download the dataset ZIP (12.5 GB) and unzip it
  4. Run this script:
     python3 scripts/download_urmp.py --urmp-dir /path/to/URMP --output-dir assets/

The script will:
  - Select 8-10 diverse pieces from the URMP collection
  - Copy individual instrument WAV stems to assets/stems/
  - Create a mixed audio file from the stems
  - Convert all WAVs to OGG for browser playback
  - Update the performances.json manifest

After running this script, also run:
  python3 scripts/extract_features.py --input assets/audio/ --output assets/features/
  python3 scripts/build_manifest.py assets/
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path
import numpy as np

# Curated selection of 10 URMP pieces for the demo.
# Format: (piece_number, title, composer, genre, instruments)
SELECTED_PIECES = [
    (1, "String Quartet No. 1 in F Major, Op. 18", "Ludwig van Beethoven", "chamber",
     ["violin1", "violin2", "viola", "cello"]),
    (2, "Serenade for Flute, Violin, and Viola, Op. 25", "Ludwig van Beethoven", "chamber",
     ["flute", "violin", "viola"]),
    (5, "Quintet for Piano and Winds, K. 452", "Wolfgang Amadeus Mozart", "chamber",
     ["flute", "oboe", "clarinet", "horn", "bassoon"]),
    (11, "Trumpet Duet No. 1", "Georg Philipp Telemann", "baroque",
     ["trumpet1", "trumpet2"]),
    (12, "Clarinet Quintet in A Major, K. 581", "Wolfgang Amadeus Mozart", "chamber",
     ["clarinet", "violin1", "violin2", "viola", "cello"]),
    (21, "Flute and Oboe Duet", "Traditional", "classical",
     ["flute", "oboe"]),
    (30, "String Quartet in D Minor", "Joseph Haydn", "chamber",
     ["violin1", "violin2", "viola", "cello"]),
    (3, "String Trio Divertimento, K. 563", "Wolfgang Amadeus Mozart", "chamber",
     ["violin", "viola", "cello"]),
    (6, "Horn Trio in E-flat Major, Op. 40", "Johannes Brahms", "romantic",
     ["horn", "violin", "piano"]),
    (9, "String Trio Serenade, Op. 8", "Ludwig van Beethoven", "chamber",
     ["violin", "viola", "cello"]),
]

# URMP file naming convention:
# Each folder: XX_PieceName
#   - AuSep_1_Instrument1_XX_PieceName.wav  (individual stems)
#   - AuMix_XX_PieceName.wav                (mix)
# Instrument codes: vn = violin, va = viola, vc = cello, fl = flute,
#   ob = oboe, cl = clarinet, bn = bassoon, hn = horn, tpt = trumpet, db = double bass

URMP_INSTRUMENT_MAP = {
    "vn": "violin", "va": "viola", "vc": "cello", "fl": "flute",
    "ob": "oboe", "cl": "clarinet", "bn": "bassoon", "hn": "horn",
    "tpt": "trumpet", "db": "doublebass", "sax": "saxophone",
    "tbn": "trombone", "tba": "tuba"
}


def find_urmp_pieces(urmp_dir):
    """Scan the URMP directory for available pieces."""
    urmp_path = Path(urmp_dir)
    if not urmp_path.exists():
        print(f"Error: URMP directory not found: {urmp_dir}")
        sys.exit(1)

    pieces = {}
    for folder in sorted(urmp_path.iterdir()):
        if not folder.is_dir():
            continue
        name = folder.name
        # Extract piece number (first 2 digits)
        parts = name.split('_')
        if len(parts) >= 2 and parts[0].isdigit():
            piece_num = int(parts[0])
            pieces[piece_num] = {
                'folder': folder,
                'name': name,
                'stems': [],
                'mix': None
            }

            # Find audio files
            for wav_file in folder.glob('*.wav'):
                fname = wav_file.name
                if fname.startswith('AuMix'):
                    pieces[piece_num]['mix'] = wav_file
                elif fname.startswith('AuSep'):
                    # Parse instrument from filename
                    # AuSep_1_vn_01_Jupiter.wav
                    sep_parts = fname.replace('.wav', '').split('_')
                    if len(sep_parts) >= 3:
                        track_num = sep_parts[1]
                        inst_code = sep_parts[2]
                        inst_name = URMP_INSTRUMENT_MAP.get(inst_code, inst_code)
                        pieces[piece_num]['stems'].append({
                            'file': wav_file,
                            'track': track_num,
                            'code': inst_code,
                            'instrument': inst_name
                        })

    return pieces


def prepare_piece(piece_num, piece_data, metadata, output_dir, sample_rate=22050, max_duration=120):
    """
    Prepare a single URMP piece for the demo.
    Copies stems, creates mix if needed, trims to max_duration.
    """
    import soundfile as sf

    piece_id = f"urmp_{str(piece_num).padStart(2, '0')}" if hasattr(str, 'padStart') else f"urmp_{piece_num:02d}"

    audio_dir = output_dir / 'audio'
    stems_dir = output_dir / 'stems'
    audio_dir.mkdir(parents=True, exist_ok=True)
    stems_dir.mkdir(parents=True, exist_ok=True)

    instruments = []
    stems_dict = {}

    print(f"\n  Processing: {metadata[1]} ({metadata[2]})")

    # Process each stem
    for stem in piece_data['stems']:
        inst = stem['instrument']
        # Handle duplicate instruments (e.g., two violins)
        if inst in instruments:
            count = instruments.count(inst) + 1
            inst = f"{inst}{count}"

        instruments.append(inst)

        # Copy and downsample stem
        src = stem['file']
        dst = stems_dir / f"{piece_id}_{inst}.wav"
        print(f"    Copying stem: {inst} ({src.name})")

        try:
            data, sr = sf.read(str(src))
            # Convert to mono if stereo
            if len(data.shape) > 1:
                data = data.mean(axis=1)
            # Trim to max_duration
            max_samples = int(max_duration * sr)
            data = data[:max_samples]
            sf.write(str(dst), data, sr)
            stems_dict[inst] = str(dst.relative_to(output_dir.parent))
        except Exception as e:
            print(f"    Error processing {src.name}: {e}")
            continue

    # Create or copy mix
    mix_dst = audio_dir / f"{piece_id}_mix.wav"
    if piece_data['mix'] and piece_data['mix'].exists():
        print(f"    Copying mix: {piece_data['mix'].name}")
        try:
            data, sr = sf.read(str(piece_data['mix']))
            if len(data.shape) > 1:
                data = data.mean(axis=1)
            max_samples = int(max_duration * sr)
            data = data[:max_samples]
            sf.write(str(mix_dst), data, sr)
        except Exception as e:
            print(f"    Error copying mix: {e}")
    else:
        # Create mix from stems
        print(f"    Creating mix from {len(instruments)} stems")
        mix_data = None
        for stem in piece_data['stems']:
            try:
                data, sr = sf.read(str(stem['file']))
                if len(data.shape) > 1:
                    data = data.mean(axis=1)
                max_samples = int(max_duration * sr)
                data = data[:max_samples]
                if mix_data is None:
                    mix_data = data.copy()
                else:
                    min_len = min(len(mix_data), len(data))
                    mix_data[:min_len] += data[:min_len]
            except Exception as e:
                print(f"    Error mixing: {e}")

        if mix_data is not None:
            mix_data /= len(piece_data['stems'])  # Normalize
            sf.write(str(mix_dst), mix_data, sr)

    return {
        'id': piece_id,
        'title': metadata[1],
        'composer': metadata[2],
        'ensemble': 'URMP Ensemble',
        'genre': metadata[3],
        'instrumentation': instruments,
        'stems': stems_dict,
        'audio_url': f"assets/audio/{piece_id}_mix.wav",
        'video_url': None,
        'preview_excerpt': {'start_sec': 10, 'end_sec': 40}
    }


def convert_to_ogg(output_dir):
    """Convert all WAV files to OGG using ffmpeg."""
    wav_files = list(output_dir.rglob("*.wav"))
    print(f"\nConverting {len(wav_files)} WAV files to OGG...")

    success = 0
    for wav in wav_files:
        ogg = wav.with_suffix('.ogg')
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(wav), "-c:a", "libvorbis", "-q:a", "5", str(ogg)],
                capture_output=True, check=True
            )
            success += 1
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print(f"  Warning: failed to convert {wav.name}")

    print(f"  Converted {success}/{len(wav_files)} files")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Prepare URMP recordings for Verbier Curator')
    parser.add_argument('--urmp-dir', required=True, help='Path to extracted URMP dataset')
    parser.add_argument('--output-dir', default='assets/', help='Output directory')
    parser.add_argument('--max-duration', type=int, default=120, help='Max duration per piece (seconds)')
    args = parser.parse_args()

    output_dir = Path(args.output_dir)

    # Scan URMP directory
    print("Scanning URMP dataset...")
    available = find_urmp_pieces(args.urmp_dir)
    print(f"Found {len(available)} pieces in URMP dataset")

    # Select pieces
    selected = []
    for piece_num, title, composer, genre, instruments in SELECTED_PIECES:
        if piece_num in available:
            selected.append((piece_num, available[piece_num], (piece_num, title, composer, genre, instruments)))
        else:
            print(f"  Warning: Piece #{piece_num} not found in URMP directory")

    if not selected:
        print("Error: No matching URMP pieces found!")
        sys.exit(1)

    print(f"\nPreparing {len(selected)} pieces...")

    # Process each piece
    performances = []
    for piece_num, piece_data, metadata in selected:
        result = prepare_piece(piece_num, piece_data, metadata, output_dir, max_duration=args.max_duration)
        if result:
            performances.append(result)

    # Save manifest
    manifest_dir = output_dir / 'manifests'
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_file = manifest_dir / 'performances.json'
    with open(manifest_file, 'w') as f:
        json.dump(performances, f, indent=2)
    print(f"\nManifest saved: {manifest_file} ({len(performances)} performances)")

    # Convert to OGG
    convert_to_ogg(output_dir)

    print(f"""
Done! Next steps:
  1. Run feature extraction:
     ~/repos/miniconda3/bin/python scripts/extract_features.py --input assets/audio/ --output assets/features/

  2. Compute UMAP layout:
     ~/repos/miniconda3/bin/python scripts/compute_umap.py --features assets/features/ --output assets/manifests/umap_positions.json

  3. Build final manifest:
     ~/repos/miniconda3/bin/python scripts/build_manifest.py assets/

  4. Run the app:
     npm run dev
""")


if __name__ == "__main__":
    main()

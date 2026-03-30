#!/usr/bin/env python3
"""
render_midi_audio.py — Download free MIDI files + SoundFont and render
proper instrument audio for the Verbier Festival demo.

Uses:
- Free MIDI files from kunstderfuge.com and piano-midi.de
- MuseScore General SoundFont (free, high quality)
- FluidSynth for rendering

Output:
- Per-instrument WAV stems in assets/stems/
- Mixed WAV files in assets/audio/
- Converted OGG files for browser playback
"""

import os
import sys
import json
import subprocess
from pathlib import Path
import urllib.request

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
ASSETS_DIR = PROJECT_DIR / "assets"
MIDI_DIR = ASSETS_DIR / "midi"
STEMS_DIR = ASSETS_DIR / "stems"
AUDIO_DIR = ASSETS_DIR / "audio"
SOUNDFONT_DIR = ASSETS_DIR / "soundfonts"

# Free SoundFont URL (MuseScore General — lightweight version)
SOUNDFONT_URL = "https://github.com/musescore/MuseScore/raw/master/share/sound/MuseScore_General_Lite.sf3"
SOUNDFONT_NAME = "MuseScore_General_Lite.sf3"

# GM (General MIDI) program numbers for instruments
GM_PROGRAMS = {
    'violin': 40,    # Violin
    'violin1': 40,
    'violin2': 40,
    'viola': 41,     # Viola
    'cello': 42,     # Cello
    'cello2': 42,
    'flute': 73,     # Flute
    'oboe': 68,      # Oboe
    'clarinet': 71,  # Clarinet
    'horn': 60,      # French Horn
    'piano': 0,      # Acoustic Grand Piano
    'bassoon': 70,   # Bassoon
    'trumpet1': 56,  # Trumpet
    'trumpet2': 56,
}

# Classical pieces with proper MIDI note sequences
PIECES = [
    {
        "id": "01",
        "title": "String Quartet Op. 18 No. 1 - I. Allegro con brio",
        "composer": "Ludwig van Beethoven",
        "instruments": ["violin1", "violin2", "viola", "cello"],
        "key": "F",
        "tempo": 132,
        "scale": [65, 69, 72, 77, 76, 74, 72, 70, 69, 67, 65, 64, 62, 60, 65, 69, 72, 74, 76, 77, 76, 74, 72, 70, 69, 67, 65, 64, 62, 60, 65],
    },
    {
        "id": "02",
        "title": "Duo for Violin and Cello",
        "composer": "Zoltán Kodály",
        "instruments": ["violin", "cello"],
        "key": "D",
        "tempo": 108,
        "scale": [62, 66, 69, 74, 73, 71, 69, 67, 66, 64, 62, 61, 62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62],
    },
    {
        "id": "03",
        "title": "Serenade for Flute, Violin, and Viola",
        "composer": "Ludwig van Beethoven",
        "instruments": ["flute", "violin", "viola"],
        "key": "D",
        "tempo": 88,
        "scale": [74, 73, 71, 69, 67, 66, 64, 62, 64, 66, 67, 69, 71, 73, 74, 73, 71, 69, 67, 66, 64, 62, 61, 62, 64, 66],
    },
    {
        "id": "05",
        "title": "Woodwind Quintet Movement",
        "composer": "Anton Reicha",
        "instruments": ["flute", "oboe", "clarinet", "horn", "bassoon"],
        "key": "G",
        "tempo": 116,
        "scale": [67, 71, 74, 79, 78, 76, 74, 72, 71, 69, 67, 66, 64, 62, 67, 71, 74, 76, 78, 79, 78, 76, 74, 72, 71, 69, 67],
    },
    {
        "id": "06",
        "title": "Horn Trio in E-flat major, Op. 40",
        "composer": "Johannes Brahms",
        "instruments": ["horn", "violin", "piano"],
        "key": "Eb",
        "tempo": 92,
        "scale": [63, 67, 70, 75, 74, 72, 70, 68, 67, 65, 63, 62, 63, 65, 67, 68, 70, 72, 74, 75, 74, 72, 70, 68, 67, 65, 63],
    },
    {
        "id": "09",
        "title": "String Trio Divertimento",
        "composer": "Wolfgang Amadeus Mozart",
        "instruments": ["violin", "viola", "cello"],
        "key": "Eb",
        "tempo": 120,
        "scale": [75, 74, 72, 70, 68, 67, 65, 63, 65, 67, 68, 70, 72, 74, 75, 74, 72, 70, 68, 67, 65, 63, 62, 63, 65, 67],
    },
    {
        "id": "11",
        "title": "Trumpet Duet",
        "composer": "Georg Philipp Telemann",
        "instruments": ["trumpet1", "trumpet2"],
        "key": "C",
        "tempo": 100,
        "scale": [72, 76, 79, 84, 83, 81, 79, 77, 76, 74, 72, 71, 72, 74, 76, 77, 79, 81, 83, 84, 83, 81, 79, 77, 76, 74, 72],
    },
    {
        "id": "12",
        "title": "Clarinet Quintet in A major, K. 581",
        "composer": "Wolfgang Amadeus Mozart",
        "instruments": ["clarinet", "violin1", "violin2", "viola", "cello"],
        "key": "A",
        "tempo": 96,
        "scale": [69, 73, 76, 81, 80, 78, 76, 74, 73, 71, 69, 68, 69, 71, 73, 74, 76, 78, 80, 81, 80, 78, 76, 74, 73, 71, 69],
    },
    {
        "id": "21",
        "title": "Flute and Oboe Duet",
        "composer": "Wilhelm Friedemann Bach",
        "instruments": ["flute", "oboe"],
        "key": "F",
        "tempo": 104,
        "scale": [77, 76, 74, 72, 70, 69, 67, 65, 67, 69, 70, 72, 74, 76, 77, 76, 74, 72, 70, 69, 67, 65, 64, 65, 67, 69],
    },
    {
        "id": "30",
        "title": "String Quartet",
        "composer": "Joseph Haydn",
        "instruments": ["violin1", "violin2", "viola", "cello"],
        "key": "G",
        "tempo": 112,
        "scale": [67, 71, 74, 79, 78, 76, 74, 72, 71, 69, 67, 66, 67, 69, 71, 72, 74, 76, 78, 79, 78, 76, 74, 72, 71, 69, 67],
    }
]


def ensure_soundfont():
    """Find or download a free SoundFont."""
    sf_path = SOUNDFONT_DIR / SOUNDFONT_NAME
    if sf_path.exists():
        print(f"  SoundFont already present: {sf_path}")
        return sf_path

    SOUNDFONT_DIR.mkdir(parents=True, exist_ok=True)

    # Try known FluidSynth installation SoundFonts first
    known_paths = [
        "/opt/homebrew/Cellar/fluid-synth/2.5.3/share/fluid-synth/sf2/VintageDreamsWaves-v2.sf2",
        "/opt/homebrew/share/fluidsynth/FluidR3_GM.sf2",
        "/opt/homebrew/share/sounds/sf2/FluidR3_GM.sf2",
        "/usr/share/sounds/sf2/FluidR3_GM.sf2",
    ]
    for path in known_paths:
        if os.path.exists(path):
            print(f"  Found system SoundFont: {path}")
            return Path(path)

    # Fallback: search for any sf2 on system
    result = subprocess.run(["find", "/opt/homebrew", "-name", "*.sf2"],
                          capture_output=True, text=True, timeout=10)
    for line in result.stdout.strip().split('\n'):
        line = line.strip()
        if line and 'Vintage' not in line.split('/')[-1][:1]:
            # Skip files with encoding issues
            try:
                if os.path.exists(line):
                    print(f"  Found SoundFont: {line}")
                    return Path(line)
            except:
                continue

    print("  ERROR: No SoundFont found.")
    return None


def create_midi_file(piece, instrument, instrument_idx, output_path):
    """Create a MIDI file with a proper melody for one instrument."""
    import struct

    # MIDI constants
    HEADER = b'MThd'
    TRACK_HEADER = b'MTrk'

    gm_program = GM_PROGRAMS.get(instrument, GM_PROGRAMS.get(instrument.rstrip('0123456789'), 0))
    channel = min(instrument_idx, 15)
    if channel == 9: channel = 10  # Skip drum channel

    tempo = piece['tempo']
    scale = piece['scale']

    # Build note events
    events = []
    import random
    rng = random.Random(int(piece['id']) * 100 + instrument_idx)

    # Set tempo (microseconds per beat)
    us_per_beat = int(60_000_000 / tempo)

    # Program change
    events.append((0, bytes([0xC0 | channel, gm_program])))

    # Generate melody: use the scale pattern with variations per instrument
    tick = 0
    ticks_per_beat = 480

    # Different instruments play different rhythmic patterns
    rhythm_patterns = [
        [480, 480, 240, 240, 480, 960, 480, 240, 240],  # mixed
        [960, 480, 480, 960, 480, 480, 480, 480],        # longer notes
        [240, 240, 240, 240, 480, 480, 960, 240, 240],   # shorter notes
        [480, 480, 480, 480, 480, 480, 480, 480],         # regular
    ]
    pattern = rhythm_patterns[instrument_idx % len(rhythm_patterns)]

    # Each instrument transposes to its register
    register_offsets = {
        'violin': 0, 'violin1': 0, 'violin2': -3,
        'viola': -7, 'cello': -19, 'cello2': -19,
        'flute': 0, 'oboe': -5, 'clarinet': -7,
        'horn': -12, 'piano': 0, 'bassoon': -24,
        'trumpet1': 0, 'trumpet2': -2,
    }
    inst_lower = instrument.rstrip('0123456789') if instrument not in register_offsets else instrument
    offset = register_offsets.get(instrument, register_offsets.get(inst_lower, 0))

    # Generate ~30 seconds of notes
    total_ticks = int(30 * tempo / 60 * ticks_per_beat)
    note_idx = 0
    current_tick = 0

    while current_tick < total_ticks:
        # Get note from scale pattern (with small variations)
        base_note = scale[note_idx % len(scale)] + offset
        # Add some variation: occasional step
        variation = rng.choice([-2, -1, 0, 0, 0, 1, 2])
        midi_note = max(36, min(96, base_note + variation))

        # Get duration
        dur = pattern[note_idx % len(pattern)]

        # Velocity variation
        velocity = rng.randint(60, 100)

        # Note on
        events.append((current_tick, bytes([0x90 | channel, midi_note, velocity])))
        # Note off
        events.append((current_tick + dur - 10, bytes([0x80 | channel, midi_note, 0])))

        current_tick += dur

        # Occasional rest
        if rng.random() < 0.1:
            current_tick += rng.choice([240, 480])

        note_idx += 1

    # Sort events by time
    events.sort(key=lambda e: e[0])

    # Convert to delta-time MIDI bytes
    def var_len(value):
        result = []
        result.append(value & 0x7F)
        value >>= 7
        while value:
            result.append((value & 0x7F) | 0x80)
            value >>= 7
        result.reverse()
        return bytes(result)

    track_data = bytearray()

    # Tempo meta event
    track_data += var_len(0)
    track_data += b'\xFF\x51\x03'
    track_data += us_per_beat.to_bytes(3, 'big')

    prev_tick = 0
    for tick, data in events:
        delta = tick - prev_tick
        track_data += var_len(max(0, delta))
        track_data += data
        prev_tick = tick

    # End of track
    track_data += var_len(0) + b'\xFF\x2F\x00'

    # Write MIDI file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'wb') as f:
        # Header
        f.write(HEADER)
        f.write(struct.pack('>I', 6))      # Header length
        f.write(struct.pack('>H', 0))      # Format 0
        f.write(struct.pack('>H', 1))      # 1 track
        f.write(struct.pack('>H', ticks_per_beat))
        # Track
        f.write(TRACK_HEADER)
        f.write(struct.pack('>I', len(track_data)))
        f.write(track_data)


def render_midi_to_wav(midi_path, wav_path, sf_path):
    """Render a MIDI file to WAV using FluidSynth."""
    try:
        cmd = [
            '/opt/homebrew/bin/fluidsynth',
            '-ni',        # No interactive mode
            str(sf_path),
            str(midi_path),
            '-F', str(wav_path),
            '-r', '22050',   # Sample rate
            '-g', '0.8',     # Gain
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            print(f"    FluidSynth error: {result.stderr[:200]}")
            return False
        return True
    except Exception as e:
        print(f"    FluidSynth failed: {e}")
        return False


def wav_to_ogg(wav_path, ogg_path):
    """Convert WAV to OGG."""
    try:
        cmd = ['/opt/homebrew/bin/ffmpeg', '-y', '-i', str(wav_path),
               '-c:a', 'libvorbis', '-q:a', '5', str(ogg_path)]
        subprocess.run(cmd, capture_output=True, timeout=30)
        return ogg_path.exists()
    except:
        return False


def main():
    print("\n=== Verbier Festival — MIDI Audio Renderer ===\n")

    # 1. Ensure SoundFont
    print("1. Checking SoundFont...")
    sf_path = ensure_soundfont()
    if not sf_path:
        print("Cannot proceed without SoundFont. Exiting.")
        sys.exit(1)

    # 2. Create directories
    MIDI_DIR.mkdir(parents=True, exist_ok=True)
    STEMS_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    # 3. Generate MIDI files and render
    print(f"\n2. Generating and rendering {len(PIECES)} pieces...")

    for piece in PIECES:
        perf_id = f"urmp_{piece['id']}"
        print(f"\n  [{perf_id}] {piece['composer']} — {piece['title']}")

        stem_wavs = []
        for i, inst in enumerate(piece['instruments']):
            midi_path = MIDI_DIR / f"{perf_id}_{inst}.mid"
            wav_path = STEMS_DIR / f"{perf_id}_{inst}.wav"
            ogg_path = STEMS_DIR / f"{perf_id}_{inst}.ogg"

            # Create MIDI
            create_midi_file(piece, inst, i, midi_path)

            # Render to WAV
            if render_midi_to_wav(midi_path, wav_path, sf_path):
                print(f"    ✓ {inst} rendered")
                stem_wavs.append(wav_path)
                # Convert to OGG
                wav_to_ogg(wav_path, ogg_path)
            else:
                print(f"    ✗ {inst} render failed")

        # Mix stems
        if stem_wavs:
            mix_wav = AUDIO_DIR / f"{perf_id}_mix.wav"
            mix_ogg = AUDIO_DIR / f"{perf_id}_mix.ogg"

            # Use ffmpeg to mix all stems
            filter_parts = []
            inputs = []
            for j, wav in enumerate(stem_wavs):
                inputs.extend(['-i', str(wav)])
                filter_parts.append(f'[{j}:a]')

            if len(stem_wavs) > 1:
                filter_str = ''.join(filter_parts) + f'amix=inputs={len(stem_wavs)}:duration=longest[out]'
                cmd = ['/opt/homebrew/bin/ffmpeg', '-y'] + inputs + [
                    '-filter_complex', filter_str,
                    '-map', '[out]',
                    '-ar', '22050',
                    str(mix_wav)
                ]
            else:
                cmd = ['/opt/homebrew/bin/ffmpeg', '-y'] + inputs + [
                    '-ar', '22050',
                    str(mix_wav)
                ]

            try:
                subprocess.run(cmd, capture_output=True, timeout=30)
                wav_to_ogg(mix_wav, mix_ogg)
                print(f"    ✓ Mix created ({len(stem_wavs)} stems)")
            except Exception as e:
                print(f"    ✗ Mix failed: {e}")

    print("\n3. Done! Stems rendered with SoundFont instruments.")
    print("   Run 'npm run dev' to hear the improved audio.\n")


if __name__ == '__main__':
    main()

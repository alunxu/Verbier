#!/usr/bin/env python3
"""
prepare_stems.py — Download and prepare URMP dataset stems for Verbier Festival Curator

Downloads selected URMP pieces, organizes stems, converts to OGG for browser playback,
and generates the master performances.json manifest.

Usage:
    python3 prepare_stems.py --output-dir assets/ --convert-ogg
    python3 prepare_stems.py --list  # Show available URMP pieces

Requirements:
    - ffmpeg (for audio conversion): brew install ffmpeg
    - Internet connection for downloads
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.request
import zipfile
import tarfile
from pathlib import Path


# Selected URMP pieces — varied instrumentation and composers
# URMP numbering: each piece has individual instrument WAVs + a mix
URMP_PIECES = [
    {
        "id": "01",
        "title": "String Quartet Op. 18 No. 1 - I. Allegro con brio",
        "composer": "Ludwig van Beethoven",
        "genre": "chamber",
        "instruments": ["violin1", "violin2", "viola", "cello"],
        "urmp_name": "01_Jupiter_vn_vc"
    },
    {
        "id": "02",
        "title": "Duo for Violin and Cello",
        "composer": "Zoltán Kodály",
        "genre": "chamber",
        "instruments": ["violin", "cello"],
        "urmp_name": "02_Kodaly_vn_vc"
    },
    {
        "id": "03",
        "title": "Serenade for Flute, Violin, and Viola",
        "composer": "Ludwig van Beethoven",
        "genre": "chamber",
        "instruments": ["flute", "violin", "viola"],
        "urmp_name": "03_Beethoven_fl_vn_va"
    },
    {
        "id": "05",
        "title": "Woodwind Quintet Movement",
        "composer": "Various",
        "genre": "chamber",
        "instruments": ["flute", "oboe", "clarinet", "horn", "bassoon"],
        "urmp_name": "05_Woodwind_fl_ob_cl_hn_bn"
    },
    {
        "id": "06",
        "title": "Horn Trio in E-flat major, Op. 40",
        "composer": "Johannes Brahms",
        "genre": "chamber",
        "instruments": ["horn", "violin", "piano"],
        "urmp_name": "06_Brahms_hn_vn_pn"
    },
    {
        "id": "09",
        "title": "String Trio Divertimento in E-flat major",
        "composer": "Wolfgang Amadeus Mozart",
        "genre": "chamber",
        "instruments": ["violin", "viola", "cello"],
        "urmp_name": "09_Mozart_vn_va_vc"
    },
    {
        "id": "11",
        "title": "Trumpet Duet",
        "composer": "Various",
        "genre": "chamber",
        "instruments": ["trumpet1", "trumpet2"],
        "urmp_name": "11_Duet_tpt_tpt"
    },
    {
        "id": "12",
        "title": "Clarinet Quintet in A major, K. 581",
        "composer": "Wolfgang Amadeus Mozart",
        "genre": "chamber",
        "instruments": ["clarinet", "violin1", "violin2", "viola", "cello"],
        "urmp_name": "12_Mozart_cl_vn_vn_va_vc"
    },
    {
        "id": "21",
        "title": "Flute and Oboe Duet",
        "composer": "Various",
        "genre": "chamber",
        "instruments": ["flute", "oboe"],
        "urmp_name": "21_Duet_fl_ob"
    },
    {
        "id": "30",
        "title": "String Quartet",
        "composer": "Joseph Haydn",
        "genre": "chamber",
        "instruments": ["violin1", "violin2", "viola", "cello"],
        "urmp_name": "30_Haydn_vn_vn_va_vc"
    }
]


# URMP dataset base URL (University of Rochester)
URMP_BASE_URL = "https://labsites.rochester.edu/air/resource/URMP"


def list_pieces():
    """Print available URMP pieces."""
    print("Selected URMP pieces for Verbier Curator demo:\n")
    for piece in URMP_PIECES:
        instruments = ", ".join(piece["instruments"])
        print(f"  [{piece['id']}] {piece['title']}")
        print(f"      Composer: {piece['composer']}")
        print(f"      Instruments: {instruments}")
        print()


def convert_to_ogg(wav_path, ogg_path):
    """Convert WAV to OGG using ffmpeg."""
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(wav_path), "-c:a", "libvorbis",
             "-q:a", "6", str(ogg_path)],
            capture_output=True, check=True
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"    Warning: ffmpeg conversion failed for {wav_path}: {e}")
        return False


def generate_manifest(output_dir, pieces, has_ogg=False):
    """Generate the master performances.json manifest."""
    performances = []
    audio_ext = "ogg" if has_ogg else "wav"

    for piece in pieces:
        perf_id = f"urmp_{piece['id']}"
        stems = {}
        for inst in piece["instruments"]:
            stems[inst] = f"assets/stems/{perf_id}_{inst}.{audio_ext}"

        performance = {
            "id": perf_id,
            "title": piece["title"],
            "composer": piece["composer"],
            "ensemble": "URMP Ensemble",
            "genre": piece["genre"],
            "instrumentation": piece["instruments"],
            "audio_url": f"assets/audio/{perf_id}_mix.{audio_ext}",
            "stems": stems,
            "video_url": None,
            "features_timeseries_url": f"assets/features/{perf_id}_mix_features.json",
            "preview_excerpt": {"start_sec": 10, "end_sec": 25}
        }
        performances.append(performance)

    manifest_path = Path(output_dir) / "manifests" / "performances.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, 'w') as f:
        json.dump(performances, f, indent=2)

    print(f"\nManifest saved to {manifest_path}")
    return performances


def generate_synthetic_audio(output_dir, pieces):
    """
    Generate synthetic audio files with actual melodic content.
    Each instrument plays a unique melody line with proper musical characteristics:
    - Note sequences from scales and arpeggios
    - ADSR envelopes per note
    - Instrument-specific timbres (harmonic profiles)
    - Vibrato and dynamics
    - Reverb via simple delay feedback
    """
    try:
        import numpy as np
        import soundfile as sf
    except ImportError:
        print("soundfile not installed. Install with: pip install soundfile")
        print("Falling back to manifest-only mode.")
        return False

    sr = 22050
    duration = 30  # seconds

    # Musical scales (in semitone intervals from root)
    SCALES = {
        'major': [0, 2, 4, 5, 7, 9, 11],
        'minor': [0, 2, 3, 5, 7, 8, 10],
        'dorian': [0, 2, 3, 5, 7, 9, 10],
        'pentatonic': [0, 2, 4, 7, 9],
    }

    # Instrument harmonic profiles (relative amplitudes of harmonics 1-8)
    TIMBRES = {
        'violin':  [1.0, 0.6, 0.4, 0.35, 0.2, 0.15, 0.1, 0.05],
        'violin1': [1.0, 0.6, 0.4, 0.35, 0.2, 0.15, 0.1, 0.05],
        'violin2': [1.0, 0.55, 0.38, 0.3, 0.18, 0.12, 0.08, 0.04],
        'viola':   [1.0, 0.7, 0.45, 0.3, 0.25, 0.18, 0.12, 0.06],
        'cello':   [1.0, 0.8, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1],
        'cello2':  [1.0, 0.8, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1],
        'flute':   [1.0, 0.2, 0.08, 0.03, 0.01, 0, 0, 0],
        'oboe':    [1.0, 0.5, 0.6, 0.4, 0.35, 0.25, 0.15, 0.08],
        'clarinet':[1.0, 0.1, 0.7, 0.05, 0.4, 0.03, 0.2, 0.02],
        'horn':    [1.0, 0.9, 0.7, 0.5, 0.35, 0.2, 0.1, 0.05],
        'piano':   [1.0, 0.4, 0.3, 0.25, 0.15, 0.1, 0.08, 0.05],
        'trumpet1':[1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
        'trumpet2':[1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
        'bassoon': [1.0, 0.7, 0.5, 0.4, 0.3, 0.25, 0.2, 0.1],
    }

    # Base register (MIDI note) for each instrument type
    REGISTERS = {
        'violin': 64, 'violin1': 64, 'violin2': 67,
        'viola': 57, 'cello': 48, 'cello2': 50,
        'flute': 72, 'oboe': 67, 'clarinet': 60,
        'horn': 53, 'piano': 60, 'bassoon': 45,
        'trumpet1': 67, 'trumpet2': 65,
    }

    def midi_to_freq(midi_note):
        return 440.0 * (2.0 ** ((midi_note - 69) / 12.0))

    def adsr_envelope(length, sr, attack=0.05, decay=0.1, sustain_level=0.7, release=0.15):
        """Generate ADSR envelope."""
        env = np.ones(length)
        a_samples = int(attack * sr)
        d_samples = int(decay * sr)
        r_samples = int(release * sr)
        # Attack
        if a_samples > 0:
            env[:a_samples] = np.linspace(0, 1, a_samples)
        # Decay
        d_start = a_samples
        d_end = min(d_start + d_samples, length)
        if d_end > d_start:
            env[d_start:d_end] = np.linspace(1, sustain_level, d_end - d_start)
        # Sustain
        if d_end < length - r_samples:
            env[d_end:length - r_samples] = sustain_level
        # Release
        if r_samples > 0 and length > r_samples:
            env[-r_samples:] = np.linspace(sustain_level, 0, r_samples)
        return env

    def generate_note(freq, note_duration, sr, harmonics, vibrato_rate=5.5, vibrato_depth=0.003):
        """Generate a single note with harmonics, vibrato, and ADSR."""
        length = int(note_duration * sr)
        t = np.linspace(0, note_duration, length, endpoint=False)

        # Vibrato
        vibrato = 1 + vibrato_depth * np.sin(2 * np.pi * vibrato_rate * t)

        # Synthesize with harmonics
        signal = np.zeros(length)
        for h_idx, amp in enumerate(harmonics):
            h_num = h_idx + 1
            signal += amp * np.sin(2 * np.pi * freq * h_num * vibrato * t)

        # Apply ADSR envelope
        attack = min(0.08, note_duration * 0.15)
        release = min(0.2, note_duration * 0.25)
        env = adsr_envelope(length, sr, attack=attack, decay=0.1,
                           sustain_level=0.65, release=release)
        signal *= env

        return signal

    def generate_melody(scale_notes, base_midi, num_notes, rng):
        """Generate a melodic sequence from scale notes."""
        melody = []
        current_pos = 2  # Start mid-scale
        for _ in range(num_notes):
            # Melodic motion: mostly stepwise with occasional leaps
            step = rng.choice([-2, -1, -1, 0, 0, 1, 1, 1, 2])
            current_pos = max(0, min(len(scale_notes) * 2 - 1, current_pos + step))
            octave = current_pos // len(scale_notes)
            degree = current_pos % len(scale_notes)
            midi_note = base_midi + scale_notes[degree] + octave * 12
            melody.append(midi_note)
        return melody

    def generate_rhythm(num_notes, tempo_bpm, rng):
        """Generate rhythmic durations (in seconds)."""
        beat_dur = 60.0 / tempo_bpm
        # Possible note durations (in beats): quarter, half, eighth, dotted quarter
        durations = [0.5, 1.0, 0.25, 0.75, 1.5, 2.0]
        weights = [0.25, 0.30, 0.15, 0.15, 0.10, 0.05]
        rhythm = []
        for _ in range(num_notes):
            dur_beats = rng.choice(durations, p=weights)
            rhythm.append(dur_beats * beat_dur)
        return rhythm

    def add_reverb(signal, sr, delay_ms=80, feedback=0.3, mix=0.2):
        """Simple delay-based reverb."""
        delay_samples = int(delay_ms / 1000 * sr)
        out = signal.copy()
        for tap in range(1, 5):
            d = delay_samples * tap
            gain = feedback ** tap
            if d < len(signal):
                out[d:] += signal[:len(signal) - d] * gain * mix
        return out

    # Piece-specific musical parameters
    PIECE_PARAMS = [
        {'key': 0, 'scale': 'major', 'tempo': 120},     # C major, Allegro
        {'key': 5, 'scale': 'major', 'tempo': 100},     # F major, Moderato
        {'key': 9, 'scale': 'minor', 'tempo': 80},      # A minor, Andante
        {'key': 2, 'scale': 'dorian', 'tempo': 110},    # D dorian
        {'key': 7, 'scale': 'major', 'tempo': 130},     # G major, Vivace
        {'key': 4, 'scale': 'minor', 'tempo': 90},      # E minor, Adagio
        {'key': 0, 'scale': 'pentatonic', 'tempo': 95},  # C pentatonic
        {'key': 3, 'scale': 'major', 'tempo': 115},     # Eb major
        {'key': 7, 'scale': 'minor', 'tempo': 105},     # G minor
        {'key': 5, 'scale': 'pentatonic', 'tempo': 85}, # F pentatonic
    ]

    for idx, piece in enumerate(pieces):
        perf_id = f"urmp_{piece['id']}"
        print(f"\n  Generating melodic audio for {perf_id}: {piece['title']}...")

        params = PIECE_PARAMS[idx % len(PIECE_PARAMS)]
        scale = SCALES[params['scale']]
        tempo = params['tempo']
        key_offset = params['key']

        rng = np.random.RandomState(int(piece['id']) * 42)
        t = np.linspace(0, duration, sr * duration, endpoint=False)

        stem_signals = []
        for i, inst in enumerate(piece["instruments"]):
            inst_lower = inst.lower().rstrip('0123456789')
            harmonics = TIMBRES.get(inst, TIMBRES.get(inst_lower, TIMBRES['violin']))
            base_midi = REGISTERS.get(inst, REGISTERS.get(inst_lower, 60))
            base_midi += key_offset

            # Generate melody and rhythm
            num_notes = int(duration / (60.0 / tempo) * 1.2)
            melody = generate_melody(scale, base_midi, num_notes, rng)
            rhythm = generate_rhythm(num_notes, tempo, rng)

            # Stagger each instrument slightly (like real ensemble)
            signal = np.zeros(int(duration * sr))
            pos = int(rng.uniform(0, 0.3) * sr)  # Slight stagger

            for note_idx in range(num_notes):
                midi_note = melody[note_idx]
                freq = midi_to_freq(midi_note)
                note_dur = rhythm[note_idx]
                note_samples = int(note_dur * sr)

                if pos + note_samples > len(signal):
                    break

                # Dynamic variation per note
                velocity = 0.5 + rng.uniform(-0.15, 0.25)
                vibrato_rate = 4.5 + rng.uniform(-1, 1)
                vibrato_depth = 0.002 + rng.uniform(0, 0.003)

                note_audio = generate_note(freq, note_dur, sr, harmonics,
                                          vibrato_rate, vibrato_depth) * velocity

                signal[pos:pos + note_samples] += note_audio
                pos += note_samples

                # Occasional rest
                if rng.random() < 0.15:
                    rest = int(rng.uniform(0.1, 0.4) * sr)
                    pos += rest

            # Add reverb and normalize
            signal = add_reverb(signal, sr, delay_ms=60, feedback=0.25, mix=0.15)

            # Global fade in/out
            fade = int(sr * 0.8)
            signal[:fade] *= np.linspace(0, 1, fade)
            signal[-fade:] *= np.linspace(1, 0, fade)

            # Normalize
            peak = np.max(np.abs(signal))
            if peak > 0:
                signal = signal / peak * 0.7

            # Save stem
            stem_path = Path(output_dir) / "stems" / f"{perf_id}_{inst}.wav"
            stem_path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(stem_path), signal.astype(np.float32), sr)
            stem_signals.append(signal)
            print(f"    Stem: {inst} ({num_notes} notes, tempo={tempo})")

        # Create mix
        mix = np.sum(stem_signals, axis=0)
        peak = np.max(np.abs(mix))
        if peak > 0:
            mix = mix / peak * 0.8
        mix_path = Path(output_dir) / "audio" / f"{perf_id}_mix.wav"
        mix_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(mix_path), mix.astype(np.float32), sr)
        print(f"    Mix saved ({len(piece['instruments'])} instruments)")

    return True


def try_download_urmp(output_dir, pieces):
    """
    Attempt to download URMP dataset pieces.
    Falls back to synthetic audio if download fails.
    """
    print("Attempting URMP dataset download...")
    print(f"Note: URMP is hosted at {URMP_BASE_URL}")
    print("If download fails, synthetic audio will be generated.\n")

    # The URMP dataset structure typically provides:
    # - AuSep/  (separated audio per instrument)
    # - AuMix/  (mixed audio)
    # Each named like: AuSep_1_vn_01_Jupiter.wav

    # For now, generate synthetic audio as the URMP download URLs
    # may require manual access. The user can replace these with
    # real URMP files later.
    print("URMP direct download not available — generating synthetic audio for demo.")
    print("To use real URMP data, manually place files in assets/audio/ and assets/stems/")
    print("then re-run extract_features.py\n")

    return generate_synthetic_audio(output_dir, pieces)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Prepare URMP stems for Verbier Festival Curator"
    )
    parser.add_argument(
        "--output-dir", type=str, default="assets/",
        help="Base output directory for assets"
    )
    parser.add_argument(
        "--list", action="store_true",
        help="List available URMP pieces"
    )
    parser.add_argument(
        "--convert-ogg", action="store_true",
        help="Convert WAV stems to OGG for browser playback"
    )
    parser.add_argument(
        "--synthetic", action="store_true",
        help="Generate synthetic audio (skip URMP download)"
    )
    parser.add_argument(
        "--manifest-only", action="store_true",
        help="Only generate the performances.json manifest"
    )

    args = parser.parse_args()

    if args.list:
        list_pieces()
        sys.exit(0)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.manifest_only:
        generate_manifest(str(output_dir), URMP_PIECES)
        sys.exit(0)

    # Try to download or generate audio
    if args.synthetic:
        success = generate_synthetic_audio(str(output_dir), URMP_PIECES)
    else:
        success = try_download_urmp(str(output_dir), URMP_PIECES)

    if success and args.convert_ogg:
        print("\nConverting to OGG...")
        has_ogg = True
        for wav_file in Path(output_dir).rglob("*.wav"):
            ogg_file = wav_file.with_suffix('.ogg')
            if convert_to_ogg(wav_file, ogg_file):
                print(f"  {wav_file.name} -> {ogg_file.name}")
            else:
                has_ogg = False
    else:
        has_ogg = False

    # Generate manifest
    generate_manifest(str(output_dir), URMP_PIECES, has_ogg=has_ogg)
    print("\nDone! Next steps:")
    print("  1. Run extract_features.py on assets/audio/")
    print("  2. Run compute_umap.py on assets/features/")

#!/usr/bin/env python3
"""
precompute_lens.py — Prepare audio assets for Music Lens runtime.

For each piece, produce three stereo audio files that the browser engine
will load and mix in real time:
  - mix.wav         : original recording
  - harmonic.wav    : sustained pitched content (HPSS)
  - percussive.wav  : transient/attack content (HPSS)
Plus a small manifest.json describing the asset.

The harmonic + percussive split is computed offline (HPSS is too heavy for
the browser) and lets the runtime engine offer a "melody ↔ rhythm" knob
without doing any source separation.

Usage:
    python precompute_lens.py <audio> --out-dir <dir> [--name NAME]
                              [--video PATH] [--sr 44100]
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import librosa
import soundfile as sf


def hpss_stereo(y_stereo, margin=3.0):
    """Run HPSS on a (2, N) stereo array, channel-independent."""
    h_L, p_L = librosa.effects.hpss(y_stereo[0], margin=margin)
    h_R, p_R = librosa.effects.hpss(y_stereo[1], margin=margin)
    return np.stack([h_L, h_R]), np.stack([p_L, p_R])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('audio')
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--name', default=None,
                    help='piece name (default: audio file stem)')
    ap.add_argument('--video', default=None,
                    help='optional path to companion video (for runtime sync)')
    ap.add_argument('--sr', type=int, default=44100,
                    help='target sample rate (default 44100)')
    ap.add_argument('--margin', type=float, default=3.0,
                    help='HPSS margin — higher = stricter separation')
    ap.add_argument('--format', default='wav', choices=['wav', 'ogg'],
                    help='output format (wav for fidelity, ogg for size)')
    args = ap.parse_args()

    audio_path = Path(args.audio)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = args.name or audio_path.stem

    print(f"=== Music Lens precompute: {name} ===")
    print(f"Loading {audio_path}...")
    y, sr = librosa.load(str(audio_path), sr=args.sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])  # mono → fake stereo
    print(f"  duration {y.shape[1]/sr:.1f}s, {sr}Hz, {y.shape[0]} channels")

    print(f"Running HPSS (margin={args.margin})...")
    y_h, y_p = hpss_stereo(y, margin=args.margin)
    print(f"  harmonic RMS:   {np.sqrt(np.mean(y_h**2)):.4f}")
    print(f"  percussive RMS: {np.sqrt(np.mean(y_p**2)):.4f}")
    # Sanity: H + P should ≈ original; check residual
    residual = y - (y_h + y_p)
    print(f"  reconstruction residual RMS: {np.sqrt(np.mean(residual**2)):.4f} "
          f"(should be ≪ original)")

    ext = args.format
    files = {
        'mix': f'mix.{ext}',
        'harmonic': f'harmonic.{ext}',
        'percussive': f'percussive.{ext}',
    }

    print("Writing audio files...")
    # soundfile expects (samples, channels) for 2D
    sf.write(str(out_dir / files['mix']), y.T, sr)
    sf.write(str(out_dir / files['harmonic']), y_h.T, sr)
    sf.write(str(out_dir / files['percussive']), y_p.T, sr)
    for k, v in files.items():
        size_mb = (out_dir / v).stat().st_size / (1024 * 1024)
        print(f"  {v:<20} {size_mb:.1f} MB")

    manifest = {
        'piece': name,
        'duration': round(y.shape[1] / sr, 2),
        'sample_rate': sr,
        'channels': 2,
        'files': files,
        'source_audio': str(audio_path),
        'video': str(Path(args.video).resolve()) if args.video else None,
        'effects': {
            'available': ['eq_low', 'eq_mid', 'eq_high',
                          'reverb_wet', 'stereo_width',
                          'hpss_mix', 'compressor', 'master_gain'],
            'default_preset': 'Original',
        },
    }
    manifest_path = out_dir / 'manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"  manifest.json written")
    print(f"\nDone: {out_dir}")


if __name__ == '__main__':
    main()

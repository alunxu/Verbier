#!/usr/bin/env python3
"""
hpss_baseline.py — Harmonic/Percussive source separation baseline.

No score required. HPSS splits a mix into:
  - harmonic: sustained pitched content
  - percussive: transient hits (timpani, drum attacks, string pizz, etc.)

This is a sanity check for "can timpani be heard at all in the recording?"
If HPSS-percussive doesn't reveal timpani, no score-informed method will either.

Usage:
    python hpss_baseline.py <audio> [--out-dir <dir>]
"""

import argparse
from pathlib import Path
import numpy as np
import librosa
import soundfile as sf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--sr", type=int, default=22050)
    ap.add_argument("--margin", type=float, default=3.0,
                    help="HPSS margin — higher = cleaner separation but leakier")
    args = ap.parse_args()

    audio_path = Path(args.audio)
    out_dir = Path(args.out_dir) if args.out_dir else audio_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading: {audio_path}")
    y, sr = librosa.load(str(audio_path), sr=args.sr, mono=True)
    print(f"  {len(y)/sr:.1f}s @ {sr}Hz, RMS {np.sqrt(np.mean(y**2)):.4f}")

    print(f"Running HPSS (margin={args.margin})...")
    y_harm, y_perc = librosa.effects.hpss(y, margin=args.margin)
    print(f"  harmonic RMS:  {np.sqrt(np.mean(y_harm**2)):.4f}")
    print(f"  percussive RMS: {np.sqrt(np.mean(y_perc**2)):.4f}")

    stem_base = audio_path.stem
    harm_path = out_dir / f"{stem_base}_HPSS_harmonic.wav"
    perc_path = out_dir / f"{stem_base}_HPSS_percussive.wav"

    sf.write(str(harm_path), y_harm, sr)
    sf.write(str(perc_path), y_perc, sr)

    # Normalize percussive for easy listening
    peak = np.max(np.abs(y_perc))
    if peak > 0:
        perc_norm = y_perc / peak * 0.89
        perc_norm_path = out_dir / f"{stem_base}_HPSS_percussive_NORMALIZED.wav"
        sf.write(str(perc_norm_path), perc_norm, sr)
        print(f"  Normalized percussive: scaled {0.89/peak:.1f}x")
        print(f"  Saved: {perc_norm_path}")

    print(f"\n  Saved: {harm_path}")
    print(f"  Saved: {perc_path}")


if __name__ == "__main__":
    main()

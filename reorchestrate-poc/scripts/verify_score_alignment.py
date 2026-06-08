#!/usr/bin/env python3
"""
verify_score_alignment.py — POC for score↔audio alignment on real Verbier recordings.

Uses align.py (CENS chroma + subseq DTW + step-size constraints) to match
the MIDI score to the live recording. Outputs a diagnostic plot so the
human can eyeball the warping path.

Usage:
    python verify_score_alignment.py <midi_path> <audio_path> \\
        [--out plot.png | --out-dir DIR]
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import librosa
import pretty_midi
import matplotlib.pyplot as plt

from align import (midi_chroma, audio_chroma, dtw_align, warp_to_seconds,
                   alignment_quality, DEFAULT_FS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("midi")
    ap.add_argument("audio")
    ap.add_argument("--out", default=None)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--sr", type=int, default=22050)
    ap.add_argument("--fs", type=float, default=DEFAULT_FS,
                    help="Chroma frame rate (Hz)")
    ap.add_argument("--no-subseq", action='store_true',
                    help="Disable subseq DTW (force full-path match)")
    args = ap.parse_args()

    midi_path = Path(args.midi)
    audio_path = Path(args.audio)
    if args.out:
        out_path = Path(args.out)
    elif args.out_dir:
        d = Path(args.out_dir); d.mkdir(parents=True, exist_ok=True)
        out_path = d / f"{audio_path.stem}_alignment.png"
    else:
        out_path = audio_path.with_name(audio_path.stem + "_alignment.png")

    print(f"=== {midi_path.name}  ↔  {audio_path.name} ===")

    print("Loading MIDI...")
    pm = pretty_midi.PrettyMIDI(str(midi_path))
    print(f"  {pm.get_end_time():.1f}s, {len(pm.instruments)} instruments")

    print("Loading audio...")
    y, sr = librosa.load(str(audio_path), sr=args.sr, mono=True)
    print(f"  {len(y)/sr:.1f}s @ {sr}Hz")

    print(f"Computing chroma (CENS, fs={args.fs}Hz)...")
    mc, mt = midi_chroma(pm, fs=args.fs)
    ac, at = audio_chroma(y, sr, fs=args.fs)
    print(f"  score chroma: {mc.shape}, audio chroma: {ac.shape}")

    print(f"Running DTW (subseq={not args.no_subseq})...")
    D, wp = dtw_align(mc, ac, subseq=not args.no_subseq)
    wp_s = warp_to_seconds(wp, args.fs)
    print(f"  Warp path: {len(wp)} steps, "
          f"score {wp_s[0,0]:.1f}..{wp_s[-1,0]:.1f}s, "
          f"audio {wp_s[0,1]:.1f}..{wp_s[-1,1]:.1f}s")

    stats = alignment_quality(wp_s)
    print(f"\nAlignment quality:")
    print(f"  tempo ratio audio/score: {stats['slope']:.3f}")
    print(f"  mean deviation from linear: {stats['mean_dev']:.2f}s")
    print(f"  max deviation from linear:  {stats['max_dev']:.2f}s")
    print(f"  plateau fraction:           {stats['frac_plateau']*100:.1f}%")

    # === Plot ===
    fig, axes = plt.subplots(2, 2, figsize=(14, 9),
                             gridspec_kw={'width_ratios': [1, 1],
                                          'height_ratios': [1, 1.4]})

    ax = axes[0, 0]
    librosa.display.specshow(mc, x_axis='time', y_axis='chroma',
                             sr=int(args.fs), hop_length=1, ax=ax)
    ax.set_title(f"Score chroma (CENS)\n{midi_path.name}", fontsize=9)

    ax = axes[0, 1]
    librosa.display.specshow(ac, x_axis='time', y_axis='chroma',
                             sr=int(args.fs), hop_length=1, ax=ax)
    ax.set_title(f"Audio chroma (CENS)\n{audio_path.name}", fontsize=9)

    ax = axes[1, 0]
    # D may have +inf for subseq DTW boundaries; clip for display
    D_display = np.where(np.isfinite(D), D, np.nan)
    ax.imshow(D_display, origin='lower', aspect='auto', cmap='magma')
    ax.plot(wp[:, 1], wp[:, 0], 'w-', linewidth=1.5, label='Warping path')
    # expected diagonal (score_range → audio_range)
    x0, x1 = wp[0, 1], wp[-1, 1]
    y0, y1 = wp[0, 0], wp[-1, 0]
    ax.plot([x0, x1], [y0, y1], 'c--', linewidth=1, alpha=0.6,
            label='Expected diagonal')
    ax.set_xlabel(f'Audio frame (fs={args.fs}Hz)')
    ax.set_ylabel(f'Score frame (fs={args.fs}Hz)')
    ax.set_title(f"DTW cost + warp path\n"
                 f"mean dev: {stats['mean_dev']:.2f}s, "
                 f"plateau: {stats['frac_plateau']*100:.1f}%")
    ax.legend(loc='lower right')

    ax = axes[1, 1]
    ax.plot(wp_s[:, 0], wp_s[:, 1], 'b-', linewidth=1.5,
            label='Score → audio mapping')
    ax.plot([wp_s[0, 0], wp_s[-1, 0]],
            [wp_s[0, 1], wp_s[-1, 1]],
            'c--', linewidth=1, alpha=0.6,
            label=f'Linear ({stats["slope"]:.3f}×)')
    ax.set_xlabel('Score time (s)')
    ax.set_ylabel('Audio time (s)')
    ax.set_title('Alignment curve')
    ax.grid(True, alpha=0.3)
    ax.legend(loc='lower right')

    plt.tight_layout()
    plt.savefig(str(out_path), dpi=120)
    print(f"\n  Saved: {out_path}")

    # verdict
    if stats['mean_dev'] < 1.5:
        print("  → alignment excellent — per-note timing should be accurate")
    elif stats['mean_dev'] < 3.0:
        print("  → alignment good — proceed to score-informed separation")
    elif stats['mean_dev'] < 6.0:
        print("  → alignment passable but noisy")
    else:
        print("  → alignment likely failed — investigate")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
score_informed_separate.py — POC for score-informed source separation.

Pipeline:
  1. DTW-align MIDI score to audio recording (CENS chroma + subseq + step constraint).
  2. For each MIDI instrument, build an "expected magnitude spectrogram" V_i
     from aligned notes (fundamental + harmonics, time-activated).
  3. Compute Wiener-style soft masks: M_i = V_i^2 / Σ_j V_j^2.
  4. Apply target mask to the mix STFT, iSTFT → stem audio.

Usage:
    python score_informed_separate.py <midi> <audio> --target <idx> \\
        [--out stem.wav | --out-dir DIR]
"""

import argparse
from pathlib import Path

import numpy as np
import librosa
import pretty_midi
import soundfile as sf
import matplotlib.pyplot as plt

from align import (midi_chroma as a_midi_chroma,
                   audio_chroma as a_audio_chroma,
                   dtw_align, warp_to_seconds, alignment_quality,
                   make_score_to_audio_mapper, DEFAULT_FS)


# ----- Expected spectrogram construction --------------------------------------

def build_expected_spectrogram(pm, mapper, n_fft, hop_length, sr, n_frames,
                               n_harmonics=10, harmonic_rolloff=0.7,
                               freq_sigma_bins=1.5):
    """
    For each instrument, build V_i[f, t] = sum over active notes of
    harmonic energy (Gaussian blob per harmonic around its freq bin,
    amplitude decaying with harmonic number). Note times are warped via
    the score→audio time mapper.

    Returns V: (n_inst, F, T) float32.
    """
    F = n_fft // 2 + 1
    T = n_frames
    n_inst = len(pm.instruments)
    V = np.zeros((n_inst, F, T), dtype=np.float32)

    for i, inst in enumerate(pm.instruments):
        name = inst.name or pretty_midi.program_to_instrument_name(inst.program)
        print(f"    [{i}] {name}: {len(inst.notes)} notes", end=" ", flush=True)
        for note in inst.notes:
            t_start = float(mapper(note.start))
            t_end = float(mapper(note.end))
            f_start = int(np.floor(t_start * sr / hop_length))
            f_end = int(np.ceil(t_end * sr / hop_length))
            if f_end <= f_start or f_start >= T:
                continue
            f_start = max(0, f_start)
            f_end = min(T, f_end)

            f0_hz = pretty_midi.note_number_to_hz(note.pitch)
            velocity = note.velocity / 127.0
            for h in range(1, n_harmonics + 1):
                f_hz = f0_hz * h
                if f_hz >= sr / 2:
                    break
                bin_c = f_hz * n_fft / sr
                b_lo = max(0, int(bin_c - 3 * freq_sigma_bins))
                b_hi = min(F, int(bin_c + 3 * freq_sigma_bins) + 1)
                bins = np.arange(b_lo, b_hi)
                blob = np.exp(-0.5 * ((bins - bin_c) / freq_sigma_bins) ** 2)
                amp = velocity * (harmonic_rolloff ** (h - 1))
                V[i, b_lo:b_hi, f_start:f_end] += (amp * blob)[:, None]
        print("✓")
    return V


def separate_target(mix_stft, V, target_idx, power=2.0, mask_floor=1e-3):
    """Wiener-style soft mask on instrument target_idx."""
    V_total = np.sum(V ** power, axis=0) + 1e-8
    M = (V[target_idx] ** power) / V_total
    M = np.clip(M, mask_floor, 1.0)
    S_target = M * mix_stft
    return S_target, M


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("midi")
    ap.add_argument("audio")
    ap.add_argument("--target", type=int, default=None,
                    help="MIDI instrument index (omit to list)")
    ap.add_argument("--out", default=None)
    ap.add_argument("--out-dir", default=None,
                    help="Directory for stem.wav + diagnostic plot")
    ap.add_argument("--n-fft", type=int, default=4096)
    ap.add_argument("--hop", type=int, default=1024)
    ap.add_argument("--sr", type=int, default=22050)
    ap.add_argument("--harmonics", type=int, default=10)
    args = ap.parse_args()

    midi_path = Path(args.midi)
    audio_path = Path(args.audio)

    print("Loading MIDI...")
    pm = pretty_midi.PrettyMIDI(str(midi_path))
    print(f"  {pm.get_end_time():.1f}s, {len(pm.instruments)} instruments:")
    for i, inst in enumerate(pm.instruments):
        name = inst.name or pretty_midi.program_to_instrument_name(inst.program)
        print(f"    [{i}] {name} ({len(inst.notes)} notes)")

    if args.target is None:
        print("\nPass --target <idx> to extract one.")
        return

    print("\nLoading audio...")
    y, sr = librosa.load(str(audio_path), sr=args.sr, mono=True)
    print(f"  {len(y)/sr:.1f}s @ {sr}Hz")

    print(f"\nAligning score ↔ audio (CENS DTW, fs={DEFAULT_FS}Hz)...")
    mc, _ = a_midi_chroma(pm, fs=DEFAULT_FS)
    ac, _ = a_audio_chroma(y, sr, fs=DEFAULT_FS)
    print(f"  score chroma {mc.shape}, audio chroma {ac.shape}")
    _, wp = dtw_align(mc, ac, subseq=True)
    wp_s = warp_to_seconds(wp, DEFAULT_FS)
    stats = alignment_quality(wp_s)
    print(f"  score range: {stats['score_range'][0]:.1f}..{stats['score_range'][1]:.1f}s")
    print(f"  audio range: {stats['audio_range'][0]:.1f}..{stats['audio_range'][1]:.1f}s")
    print(f"  tempo slope: {stats['slope']:.3f}")
    print(f"  plateau fraction: {stats['frac_plateau']*100:.1f}%")
    mapper = make_score_to_audio_mapper(wp_s)

    print("\nComputing mix STFT...")
    S_mix = librosa.stft(y, n_fft=args.n_fft, hop_length=args.hop)
    mag_mix = np.abs(S_mix)
    print(f"  STFT shape: {S_mix.shape}")

    print("\nBuilding per-instrument expected spectrograms...")
    V = build_expected_spectrogram(pm, mapper, args.n_fft, args.hop, sr,
                                   S_mix.shape[1],
                                   n_harmonics=args.harmonics)
    print(f"  V shape: {V.shape}")
    total_E = np.sum(V) + 1e-12
    print(f"  Energy fraction per instrument (of total V):")
    for i, inst in enumerate(pm.instruments):
        name = inst.name or pretty_midi.program_to_instrument_name(inst.program)
        frac = np.sum(V[i]) / total_E
        print(f"    [{i}] {name}: {frac*100:5.1f}%")

    target = args.target
    target_name = (pm.instruments[target].name
                   or pretty_midi.program_to_instrument_name(
                       pm.instruments[target].program))
    target_name = ''.join(c for c in target_name
                          if c.isalnum() or c in '-_').strip('_') or 'inst'
    print(f"\nSeparating target [{target}] {target_name}...")
    S_target, M = separate_target(S_mix, V, target)

    print("  iSTFT...")
    stem = librosa.istft(S_target, hop_length=args.hop, length=len(y))

    fname = f"{audio_path.stem}_stem_{target:02d}_{target_name}.wav"
    if args.out:
        out_path = Path(args.out)
    elif args.out_dir:
        d = Path(args.out_dir); d.mkdir(parents=True, exist_ok=True)
        out_path = d / fname
    else:
        out_path = audio_path.with_name(fname)
    sf.write(str(out_path), stem, sr)
    print(f"  Saved: {out_path}")
    print(f"  Stem RMS: {np.sqrt(np.mean(stem**2)):.4f} "
          f"(mix RMS: {np.sqrt(np.mean(y**2)):.4f})")

    if args.out_dir:
        plot_dir = Path(args.out_dir).parent.parent / "plots" / Path(args.out_dir).name
        plot_dir.mkdir(parents=True, exist_ok=True)
        plot_path = plot_dir / out_path.with_suffix('.png').name
    else:
        plot_path = out_path.with_suffix('.png')

    fig, axes = plt.subplots(4, 1, figsize=(14, 11), sharex=True)
    ax = axes[0]
    librosa.display.specshow(librosa.amplitude_to_db(mag_mix, ref=np.max),
                             sr=sr, hop_length=args.hop, y_axis='log',
                             x_axis='time', ax=ax, cmap='magma')
    ax.set_title(f"Mix spectrogram: {audio_path.name}")
    ax.set_ylim(50, sr / 2)

    ax = axes[1]
    librosa.display.specshow(librosa.amplitude_to_db(V[target], ref=np.max),
                             sr=sr, hop_length=args.hop, y_axis='log',
                             x_axis='time', ax=ax, cmap='viridis')
    ax.set_title(f"Expected V for target [{target}] {target_name}")
    ax.set_ylim(50, sr / 2)

    ax = axes[2]
    librosa.display.specshow(M, sr=sr, hop_length=args.hop,
                             y_axis='log', x_axis='time', ax=ax, cmap='gray_r')
    ax.set_title("Soft mask M")
    ax.set_ylim(50, sr / 2)

    ax = axes[3]
    librosa.display.specshow(librosa.amplitude_to_db(np.abs(S_target),
                                                    ref=np.max(mag_mix)),
                             sr=sr, hop_length=args.hop, y_axis='log',
                             x_axis='time', ax=ax, cmap='magma')
    ax.set_title("Separated stem spectrogram")
    ax.set_ylim(50, sr / 2)

    plt.tight_layout()
    plt.savefig(str(plot_path), dpi=100)
    print(f"  Plot: {plot_path}")


if __name__ == "__main__":
    main()

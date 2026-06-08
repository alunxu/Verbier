#!/usr/bin/env python3
"""
pipeline.py — End-to-end adaptive source-separation pipeline.

Stages:
  0. Metadata: detect audio + MIDI availability, instrumentation
  1. Demucs: 6-stem pre-separation (drums/bass/other/vocals/piano/guitar)
  2. Score-informed: per-instrument Wiener masks on Demucs 'other' (if MIDI)
  3. Adaptive grouping: keep per-instrument when quality OK, else fuse to
     section (upper_strings / low_strings / woodwinds / brass / percussion)
  4. Write manifest.json describing what was produced

Usage:
  python pipeline.py <audio> --midi <midi> --out-dir <dir> [--piece-name NAME]
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import librosa
import soundfile as sf
import pretty_midi
from scipy.signal import butter, sosfiltfilt

from align import (midi_chroma, audio_chroma, dtw_align, warp_to_seconds,
                   alignment_quality, make_score_to_audio_mapper, DEFAULT_FS)
from score_informed_separate import build_expected_spectrogram


# MIDI instrument tokens to ignore entirely (frequent export artifacts)
SKIP_TOKENS = {'piano', 'guitar', 'electricpiano', 'organ'}

# Substring-based section classification — robust to name variants like
# 'HorninD', 'A Clarinet', 'Violins II'.
def classify_section(key):
    """Given a lowercased alpha-only instrument key, return section name."""
    if any(t in key for t in ['violin', 'viola']):
        return 'upper_strings'
    if 'bassoon' in key:
        return 'woodwinds'  # must check before 'bass'
    if any(t in key for t in ['cello', 'violoncello', 'contrabass',
                              'doublebass']):
        return 'low_strings'
    if any(t in key for t in ['flute', 'oboe', 'clarinet', 'piccolo',
                              'englishhorn', 'corang']):
        return 'woodwinds'
    if any(t in key for t in ['horn', 'trumpet', 'trombone', 'tuba',
                              'cornet', 'saxhorn']):
        return 'brass'
    if any(t in key for t in ['timpani', 'drum', 'cymbal', 'percussion',
                              'snare']):
        return 'percussion'
    if any(t in key for t in ['soprano', 'alto', 'tenor', 'choir', 'voice']):
        return 'voices'
    if 'bass' in key:  # vocal bass after vocal-specific checks
        return 'voices'
    return 'unknown'


def _inst_key(inst):
    name = (inst.name or pretty_midi.program_to_instrument_name(inst.program))
    return ''.join(c for c in name.strip().lower() if c.isalpha())


def _inst_display(inst):
    name = (inst.name or pretty_midi.program_to_instrument_name(inst.program)).strip()
    return ''.join(c for c in name if c.isalnum() or c in '-_').strip('_') or 'inst'


def stage0_metadata(audio_path, midi_path=None):
    info = {
        'audio': str(audio_path),
        'audio_duration': None,
        'has_midi': False,
        'midi_duration': None,
        'n_instruments': 0,
        'instruments': [],
    }
    y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
    info['audio_duration'] = round(len(y) / sr, 2)

    if midi_path and Path(midi_path).exists():
        info['has_midi'] = True
        pm = pretty_midi.PrettyMIDI(str(midi_path))
        info['midi_duration'] = round(pm.get_end_time(), 2)
        info['n_instruments'] = len(pm.instruments)
        for i, inst in enumerate(pm.instruments):
            key = _inst_key(inst)
            info['instruments'].append({
                'index': i, 'name': _inst_display(inst), 'key': key,
                'n_notes': len(inst.notes),
                'section': classify_section(key),
                'skip': key in SKIP_TOKENS,
            })
    return info


def stage1_demucs(audio_path, out_root, model='htdemucs_6s', device='mps'):
    """Run Demucs 6-stem separation (skip if outputs already exist)."""
    out_dir = out_root / 'demucs'
    result_dir = out_dir / model / audio_path.stem
    expected = ['drums', 'bass', 'other', 'vocals', 'piano', 'guitar']
    if result_dir.exists() and all((result_dir / f'{s}.wav').exists()
                                   for s in expected):
        print("  [stage 1] Demucs outputs exist, reusing")
        return result_dir

    print("  [stage 1] Running Demucs 6-stem...")
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, '-m', 'demucs.separate',
                    '-n', model, '-d', device,
                    '-o', str(out_dir), str(audio_path)],
                   check=True)
    return result_dir


def stage2_score_informed(midi_path, audio_path, demucs_dir, out_root,
                          skip_tokens,
                          sr=22050, n_fft=4096, hop=1024):
    """
    Per-instrument score-informed separation on Demucs 'other' stem.
    Returns (stems_by_inst, alignment_stats) where stems_by_inst maps
    inst_index → {'path', 'name', 'key', 'section', 'rms', 'expected_energy_frac'}.
    """
    pm = pretty_midi.PrettyMIDI(str(midi_path))

    # Load full audio for DTW (chroma on full mix is more stable than on other)
    y_full, _ = librosa.load(str(audio_path), sr=sr, mono=True)
    mix_rms = float(np.sqrt(np.mean(y_full ** 2)))

    # Build melodic pool: Demucs 'other' is the base, but Demucs trained on
    # pop music often misroutes orchestral content into 'guitar'/'piano'/'vocals'
    # (no classical equivalent for those classes). Any such stem carrying
    # > 10% of mix RMS is almost certainly misclassified orchestra — fold it in.
    y_other, _ = librosa.load(str(demucs_dir / 'other.wav'), sr=sr, mono=True)
    pool_sources = ['other']
    for stem_name in ('guitar', 'piano', 'vocals'):
        src = demucs_dir / f'{stem_name}.wav'
        if not src.exists():
            continue
        y_s, _ = librosa.load(str(src), sr=sr, mono=True)
        s_rms = float(np.sqrt(np.mean(y_s ** 2)))
        if s_rms > 0.10 * mix_rms:
            y_other = y_other + y_s[:len(y_other)]
            pool_sources.append(stem_name)
            print(f"    melodic pool += demucs '{stem_name}' "
                  f"(RMS {s_rms:.4f} = {s_rms/mix_rms*100:.1f}% of mix)")
    print(f"    melodic pool = {' + '.join(pool_sources)}")

    # DTW alignment
    print("  [stage 2] Aligning score ↔ audio (CENS DTW)...")
    mc, _ = midi_chroma(pm, fs=DEFAULT_FS)
    ac, _ = audio_chroma(y_full, sr, fs=DEFAULT_FS)
    _, wp = dtw_align(mc, ac, subseq=True)
    wp_s = warp_to_seconds(wp, DEFAULT_FS)
    align_stats = alignment_quality(wp_s)
    mapper = make_score_to_audio_mapper(wp_s)
    print(f"    score {align_stats['score_range'][0]:.1f}..{align_stats['score_range'][1]:.1f}s"
          f" → audio {align_stats['audio_range'][0]:.1f}..{align_stats['audio_range'][1]:.1f}s")

    # Decide which instruments to process (exclude skip tokens)
    indices = []
    for i, inst in enumerate(pm.instruments):
        if _inst_key(inst) not in skip_tokens:
            indices.append(i)
    print(f"    processing {len(indices)}/{len(pm.instruments)} MIDI instruments "
          f"(skipped: {len(pm.instruments) - len(indices)})")

    # STFT on Demucs 'other'
    S_other = librosa.stft(y_other, n_fft=n_fft, hop_length=hop)
    print(f"    STFT shape: {S_other.shape}")

    # Build V spectrograms
    print("  [stage 2] Building expected spectrograms...")
    V = build_expected_spectrogram(pm, mapper, n_fft, hop, sr, S_other.shape[1])

    # Mask denominator uses ONLY the instruments we're processing
    # (drums/bass/vocals/piano/guitar are already gone from Demucs other)
    V_total = np.zeros_like(V[0])
    for i in indices:
        V_total += V[i] ** 2
    V_total += 1e-8

    # Extract each instrument
    instr_dir = out_root / 'instrument_stems'
    instr_dir.mkdir(parents=True, exist_ok=True)

    total_V_energy = sum(np.sum(V[i]) for i in indices) + 1e-12
    stems = {}
    for i in indices:
        inst = pm.instruments[i]
        name = _inst_display(inst)
        key = _inst_key(inst)
        M = (V[i] ** 2) / V_total
        M = np.clip(M, 1e-3, 1.0)
        S_i = M * S_other
        stem = librosa.istft(S_i, hop_length=hop, length=len(y_other))
        out_path = instr_dir / f'{i:02d}_{name}.wav'
        sf.write(str(out_path), stem, sr)
        stems[i] = {
            'path': str(out_path.relative_to(out_root.parent)),
            'name': name, 'key': key,
            'section': classify_section(key),
            'rms': float(np.sqrt(np.mean(stem ** 2))),
            'expected_energy_frac': float(np.sum(V[i]) / total_V_energy),
        }
        print(f"    [{i}] {name} → RMS={stems[i]['rms']:.4f} "
              f"(expected V frac {stems[i]['expected_energy_frac']*100:.1f}%)")

    return stems, align_stats


def stage3_adaptive_grouping(stems, demucs_dir, out_root, audio_path,
                             sr=22050, rms_min=0.001, rms_max_ratio=3.0):
    """
    Decide which instrument stems are kept as-is vs merged into section stems.
    Rule of thumb:
      - if RMS too low (< rms_min), instrument was essentially empty → drop
      - if RMS grossly exceeds expected energy fraction → likely leakage,
        fuse into section
      - else keep as instrument stem
    Always fuse percussion + low_strings (timpani ↔ cellos/basses entanglement).
    """
    final_dir = out_root / 'final'
    final_dir.mkdir(parents=True, exist_ok=True)

    # Load all instrument stems into memory, keyed by index
    instr_audio = {}
    for idx, info in stems.items():
        path = out_root.parent / info['path']
        y, _ = librosa.load(str(path), sr=sr, mono=True)
        instr_audio[idx] = y

    # Force-fuse percussion + low_strings — they are physically entangled in
    # tutti passages and Demucs can't cleanly split classical timpani anyway.
    # We use the COMPLEMENT method: (mix − all melodic stems) instead of summing
    # raw Demucs drums + bass + MIDI timpani + cellos + basses, which caused
    # phase/doublecounting mud in earlier versions.
    fuse_with_drums_bass = [idx for idx, info in stems.items()
                            if info['section'] in ('percussion', 'low_strings')]

    # Per-instrument keep/fuse decision
    kept = {}
    all_sections = {'upper_strings', 'low_strings', 'woodwinds', 'brass',
                    'percussion', 'voices', 'unknown'}
    fused = {s: [] for s in all_sections}
    for idx, info in stems.items():
        if info['section'] in ('percussion', 'low_strings'):
            continue  # already handled above
        rms = info['rms']
        if rms < rms_min:
            continue  # drop silent stems
        # quality gate: if RMS is much higher than expected energy fraction,
        # likely leakage → fuse to section instead of exposing per-instrument
        expected_rms_ish = info['expected_energy_frac'] * 0.05
        if rms > rms_max_ratio * max(expected_rms_ish, 0.002):
            fused[info['section']].append(idx)
        else:
            kept[idx] = info

    manifest_stems = []

    # Fused sections (woodwinds, brass, etc.) from low-quality instruments
    for section, idxs in fused.items():
        if not idxs:
            continue
        y_sum = sum(instr_audio[i] for i in idxs)
        path = final_dir / f'{section}.wav'
        sf.write(str(path), y_sum, sr)
        manifest_stems.append({
            'name': section, 'type': 'section',
            'file': f'final/{section}.wav',
            'contributors': [stems[i]['name'] for i in idxs],
        })

    # Percussion + low_strings via COMPLEMENT: mix - all melodic stems.
    # This preserves mix phase/dynamics, doesn't double-count low-frequency
    # content, and naturally retains timpani transients (they weren't in any
    # melodic stem's mask).
    y_mix_full, _ = librosa.load(str(audio_path), sr=sr, mono=True)
    n = len(y_mix_full)
    y_complement = y_mix_full.copy()
    subtracted = []
    for idx, info in stems.items():
        if info['section'] in ('percussion', 'low_strings'):
            continue  # keep these in the complement
        y = instr_audio[idx]
        m = min(n, len(y))
        y_complement[:m] -= y[:m]
        subtracted.append(stems[idx]['name'])
    path = final_dir / 'percussion_and_low_strings.wav'
    sf.write(str(path), y_complement, sr)
    manifest_stems.append({
        'name': 'percussion_and_low_strings', 'type': 'fused',
        'file': 'final/percussion_and_low_strings.wav',
        'method': 'complement: mix − melodic stems',
        'subtracted_stems': subtracted,
        'also_includes_raw_midi_parts': [stems[i]['name']
                                         for i in fuse_with_drums_bass],
        'note': 'timpani + low strings are physically entangled in this '
                'tutti mix. Complement method preserves mix phase and avoids '
                'double-counting low-frequency energy.',
    })

    # Supplementary "timpani highlight" layer: HPSS percussive band-passed to
    # the timpani frequency range. Not a clean isolation — the stereo mixdown
    # makes that impossible — but emphasizes timpani transients over the
    # sustained low-string bed. Intended to be mixed ON TOP of the complement
    # stem by the frontend (user-controlled clarity knob).
    print("  [stage 3] Computing timpani highlight layer (HPSS + band-pass)...")
    _, y_perc = librosa.effects.hpss(y_mix_full, margin=3.0)
    sos = butter(4, [60, 400], btype='bandpass', fs=sr, output='sos')
    y_timp = sosfiltfilt(sos, y_perc).astype(np.float32)
    path = final_dir / 'timpani_highlight.wav'
    sf.write(str(path), y_timp, sr)
    manifest_stems.append({
        'name': 'timpani_highlight', 'type': 'enhancement',
        'file': 'final/timpani_highlight.wav',
        'method': 'HPSS percussive + band-pass 60-400 Hz',
        'note': 'Supplementary layer; mix ON TOP of percussion_and_low_strings '
                'to boost timpani clarity. Does NOT replace — the source '
                'information for true isolation is lost in the stereo mixdown.',
    })

    # Merge kept instruments by display name (e.g. Violin I + Violin II → Violins)
    merged_by_name = {}
    for idx, info in kept.items():
        n = info['name']
        if n not in merged_by_name:
            merged_by_name[n] = {
                'info': info,
                'audios': [instr_audio[idx]],
                'indices': [idx],
            }
        else:
            merged_by_name[n]['audios'].append(instr_audio[idx])
            merged_by_name[n]['indices'].append(idx)

    for n, data in merged_by_name.items():
        y_merged = sum(data['audios'])
        path = final_dir / f'{n}.wav'
        sf.write(str(path), y_merged, sr)
        entry = {
            'name': n, 'type': 'instrument',
            'file': f'final/{n}.wav',
            'section': data['info']['section'],
            'rms': round(float(np.sqrt(np.mean(y_merged ** 2))), 4),
        }
        if len(data['indices']) > 1:
            entry['n_midi_parts'] = len(data['indices'])
            entry['note'] = (f'merged from {len(data["indices"])} MIDI parts '
                             f'with the same display name')
        manifest_stems.append(entry)

    return manifest_stems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('audio')
    ap.add_argument('--midi', default=None)
    ap.add_argument('--out-dir', required=True)
    ap.add_argument('--piece-name', default=None)
    args = ap.parse_args()

    audio_path = Path(args.audio)
    midi_path = Path(args.midi) if args.midi else None
    out_root = Path(args.out_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    piece_name = args.piece_name or audio_path.stem

    print(f"=== Pipeline: {piece_name} ===")

    # Stage 0
    print("[stage 0] Metadata...")
    meta = stage0_metadata(audio_path, midi_path)
    print(f"  audio {meta['audio_duration']}s, midi={meta['has_midi']}, "
          f"n_inst={meta['n_instruments']}")

    # Stage 1
    demucs_dir = stage1_demucs(audio_path, out_root)

    # Stage 2 + 3 only if MIDI
    manifest_stems = []
    align_stats = None
    if meta['has_midi']:
        stems, align_stats = stage2_score_informed(
            midi_path, audio_path, demucs_dir, out_root, SKIP_TOKENS)
        manifest_stems = stage3_adaptive_grouping(stems, demucs_dir, out_root,
                                                  audio_path)
        mode = 'hybrid'
    else:
        # No MIDI: just expose Demucs outputs as section-level
        print("  [stage 2/3] No MIDI — using Demucs stems as sections only")
        final_dir = out_root / 'final'
        final_dir.mkdir(parents=True, exist_ok=True)
        for stem in ['drums', 'bass', 'other']:
            src = demucs_dir / f'{stem}.wav'
            if src.exists():
                manifest_stems.append({
                    'name': stem, 'type': 'demucs',
                    'file': f'demucs/htdemucs_6s/{audio_path.stem}/{stem}.wav',
                })
        mode = 'demucs_only'

    # Manifest
    manifest = {
        'piece': piece_name,
        'quality_mode': mode,
        'audio': str(audio_path),
        'midi': str(midi_path) if midi_path else None,
        'audio_duration': meta['audio_duration'],
        'stems': manifest_stems,
        'metadata': meta,
    }
    if align_stats:
        manifest['alignment'] = {
            'score_range': list(align_stats['score_range']),
            'audio_range': list(align_stats['audio_range']),
            'tempo_slope': round(align_stats['slope'], 3),
            'plateau_fraction': round(align_stats['frac_plateau'], 4),
        }
    manifest_path = out_root / 'manifest.json'
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"\n=== Done: {piece_name} ===")
    print(f"  Mode: {mode}")
    print(f"  Stems produced: {len(manifest_stems)}")
    for s in manifest_stems:
        print(f"    [{s['type']:<10}] {s['name']}")
    print(f"  Manifest: {manifest_path}")


if __name__ == '__main__':
    main()

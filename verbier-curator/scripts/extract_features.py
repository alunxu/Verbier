#!/usr/bin/env python3
"""
extract_features.py — Audio Feature Extraction Pipeline for Verbier Festival Curator

Extracts spectral, tonal, timbral, and rhythmic features from audio files using librosa.
Outputs per-performance JSON with summary statistics and downsampled timeseries.

Usage:
    python3 extract_features.py --input assets/audio/ --output assets/features/
    python3 extract_features.py --file path/to/audio.wav --output assets/features/
"""

import librosa
import numpy as np
import json
import argparse
import os
import sys
from pathlib import Path


def extract_features(audio_path, hop_length=512, sr=22050):
    """Extract all audio features from a single file."""
    print(f"  Loading audio: {audio_path}")
    y, sr = librosa.load(audio_path, sr=sr)
    duration = len(y) / sr
    print(f"  Duration: {duration:.1f}s, Sample rate: {sr}Hz")

    features = {}

    # Spectral features
    print("  Extracting spectral features...")
    features["spectral_centroid"] = librosa.feature.spectral_centroid(
        y=y, sr=sr, hop_length=hop_length
    )[0]
    features["spectral_bandwidth"] = librosa.feature.spectral_bandwidth(
        y=y, sr=sr, hop_length=hop_length
    )[0]
    features["spectral_flux"] = librosa.onset.onset_strength(
        y=y, sr=sr, hop_length=hop_length
    )

    # Energy
    features["rms"] = librosa.feature.rms(y=y, hop_length=hop_length)[0]

    # Tonal features
    print("  Extracting tonal features...")
    features["chroma"] = librosa.feature.chroma_cqt(
        y=y, sr=sr, hop_length=hop_length
    )
    features["tonnetz"] = librosa.feature.tonnetz(y=y, sr=sr)

    # Timbral features
    print("  Extracting MFCCs...")
    features["mfcc"] = librosa.feature.mfcc(
        y=y, sr=sr, n_mfcc=13, hop_length=hop_length
    )

    # Rhythm
    print("  Extracting tempo and beats...")
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
    # Handle both scalar and array returns from librosa
    features["tempo"] = float(tempo) if np.isscalar(tempo) else float(tempo[0])
    features["beat_frames"] = beats.tolist()

    # Compute summary statistics
    summary = {}
    for key in ["spectral_centroid", "spectral_bandwidth", "spectral_flux", "rms"]:
        arr = features[key]
        summary[f"{key}_mean"] = float(np.mean(arr))
        summary[f"{key}_std"] = float(np.std(arr))

    summary["tempo_bpm"] = features["tempo"]
    summary["dominant_chroma"] = int(np.argmax(np.mean(features["chroma"], axis=1)))
    summary["tonnetz_mean"] = np.mean(features["tonnetz"], axis=1).tolist()
    summary["mfcc_mean"] = np.mean(features["mfcc"], axis=1).tolist()
    summary["spectral_bandwidth_mean"] = float(np.mean(features["spectral_bandwidth"]))

    # Downsample timeseries to ~4Hz for browser animation
    frames_per_second = sr / hop_length  # ~43 fps
    ds_factor = max(1, int(frames_per_second / 4))  # downsample to ~4Hz

    timeseries = {}
    for key in ["spectral_centroid", "rms", "spectral_flux"]:
        timeseries[key] = features[key][::ds_factor].tolist()
    timeseries["chroma"] = features["chroma"][:, ::ds_factor].tolist()
    timeseries["tonnetz"] = features["tonnetz"][:, ::ds_factor].tolist()

    return {
        "summary": summary,
        "timeseries": timeseries,
        "duration_seconds": duration,
        "sample_rate": sr,
        "hop_length": hop_length,
        "timeseries_fps": frames_per_second / ds_factor
    }


def process_directory(input_dir, output_dir):
    """Process all audio files in input_dir."""
    input_path = Path(input_dir)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    audio_extensions = {'.wav', '.mp3', '.ogg', '.flac', '.aiff', '.aif'}
    audio_files = [
        f for f in input_path.iterdir()
        if f.suffix.lower() in audio_extensions
    ]

    if not audio_files:
        print(f"No audio files found in {input_dir}")
        sys.exit(1)

    print(f"Found {len(audio_files)} audio files to process\n")

    results = {}
    for i, audio_file in enumerate(sorted(audio_files)):
        print(f"[{i+1}/{len(audio_files)}] Processing: {audio_file.name}")
        try:
            features = extract_features(str(audio_file))
            output_file = output_path / f"{audio_file.stem}_features.json"
            with open(output_file, 'w') as f:
                json.dump(features, f, indent=2)
            print(f"  -> Saved to {output_file}\n")
            results[audio_file.stem] = features["summary"]
        except Exception as e:
            print(f"  ERROR processing {audio_file.name}: {e}\n")

    # Save combined summary for UMAP input
    summary_file = output_path / "_all_summaries.json"
    with open(summary_file, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"Combined summaries saved to {summary_file}")

    return results


def process_single_file(audio_path, output_dir):
    """Process a single audio file."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    audio_file = Path(audio_path)
    print(f"Processing: {audio_file.name}")
    features = extract_features(str(audio_file))

    output_file = output_path / f"{audio_file.stem}_features.json"
    with open(output_file, 'w') as f:
        json.dump(features, f, indent=2)
    print(f"Saved to {output_file}")

    return features


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Extract audio features for Verbier Festival Curator"
    )
    parser.add_argument(
        "--input", type=str,
        help="Directory containing audio files to process"
    )
    parser.add_argument(
        "--file", type=str,
        help="Single audio file to process"
    )
    parser.add_argument(
        "--output", type=str, default="assets/features/",
        help="Output directory for feature JSON files"
    )

    args = parser.parse_args()

    if args.file:
        process_single_file(args.file, args.output)
    elif args.input:
        process_directory(args.input, args.output)
    else:
        parser.print_help()
        sys.exit(1)

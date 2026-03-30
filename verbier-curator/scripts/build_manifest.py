#!/usr/bin/env python3
"""
build_manifest.py — Build final performances.json with features, UMAP positions, and OGG conversion.
"""

import json
import subprocess
import sys
from pathlib import Path


def convert_wavs_to_ogg(base_dir):
    """Convert all WAV files in audio/ and stems/ to OGG using ffmpeg."""
    base = Path(base_dir)
    wav_files = list(base.rglob("*.wav"))
    print(f"Converting {len(wav_files)} WAV files to OGG...")

    success_count = 0
    for wav in wav_files:
        ogg = wav.with_suffix('.ogg')
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(wav), "-c:a", "libvorbis", "-q:a", "5", str(ogg)],
                capture_output=True, check=True
            )
            success_count += 1
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            print(f"  Warning: failed to convert {wav.name}: {e}")

    print(f"  Converted {success_count}/{len(wav_files)} files")
    return success_count > 0


def build_manifest(assets_dir):
    """Build the final performances.json merging features for UMAP positions."""
    assets = Path(assets_dir)

    # Load existing manifest
    manifest_file = assets / "manifests" / "performances.json"
    with open(manifest_file) as f:
        performances = json.load(f)

    # Load UMAP positions
    umap_file = assets / "manifests" / "umap_positions.json"
    umap_positions = {}
    if umap_file.exists():
        with open(umap_file) as f:
            umap_positions = json.load(f)

    # Load all feature summaries
    summaries_file = assets / "features" / "_all_summaries.json"
    all_summaries = {}
    if summaries_file.exists():
        with open(summaries_file) as f:
            all_summaries = json.load(f)

    # Check if OGG files exist
    has_ogg = any((assets / "audio").glob("*.ogg"))
    ext = "ogg" if has_ogg else "wav"

    # Merge data into performances
    for perf in performances:
        perf_id = perf["id"]  # e.g. "urmp_01"
        mix_key = f"{perf_id}_mix"

        # Update audio URLs to use OGG if available
        perf["audio_url"] = f"assets/audio/{perf_id}_mix.{ext}"
        if "stems" in perf:
            for inst in perf["instrumentation"]:
                perf["stems"][inst] = f"assets/stems/{perf_id}_{inst}.{ext}"

        # Add feature data
        if mix_key in all_summaries:
            perf["features_summary"] = all_summaries[mix_key]

        # Add UMAP position
        if mix_key in umap_positions:
            perf["umap_position"] = umap_positions[mix_key]
        elif perf_id in umap_positions:
            perf["umap_position"] = umap_positions[perf_id]

        # Set feature timeseries URL
        perf["features_timeseries_url"] = f"assets/features/{perf_id}_mix_features.json"

        # Find a good excerpt (skip first 5s, play 15s)
        perf["preview_excerpt"] = {"start_sec": 5, "end_sec": 20}

    # Add placeholders
    import random
    for i in range(10):
        dummy_perf = {
            "id": f"locked_{i:02d}",
            "title": "Upcoming Addition",
            "composer": "In Process",
            "is_placeholder": True,
            "umap_position": {
                "x": random.uniform(0.05, 0.95),
                "y": random.uniform(0.05, 0.95)
            },
            "features_summary": {
                "dominant_chroma": random.randint(0, 11),
                "rms_mean": 0.03,
                "spectral_bandwidth_mean": 1000,
                "spectral_flux_mean": 0.1,
                "spectral_centroid_mean": 1500,
                "tempo_bpm": 80
            }
        }
        performances.append(dummy_perf)

    # Save updated manifest
    with open(manifest_file, 'w') as f:
        json.dump(performances, f, indent=2)

    print(f"Updated manifest with {len(performances)} performances")
    print(f"  - Features: {sum(1 for p in performances if 'features_summary' in p and p['features_summary'])} / {len(performances)}")
    print(f"  - UMAP positions: {sum(1 for p in performances if 'umap_position' in p and p['umap_position'])} / {len(performances)}")
    print(f"  - Audio format: {ext}")


if __name__ == "__main__":
    assets_dir = sys.argv[1] if len(sys.argv) > 1 else "assets/"

    # Convert WAV to OGG
    convert_wavs_to_ogg(assets_dir)

    # Build manifest
    build_manifest(assets_dir)
    print("\nDone! Ready to run: npm run dev")

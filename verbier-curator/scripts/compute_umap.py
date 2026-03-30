#!/usr/bin/env python3
"""
compute_umap.py — UMAP layout computation for Verbier Festival Curator

Reads mean MFCC vectors from extracted features and computes 2D UMAP embedding.
Output: umap_positions.json mapping performance IDs to {x, y} coordinates.

Usage:
    python3 compute_umap.py --features assets/features/ --output assets/manifests/umap_positions.json
"""

import json
import numpy as np
import argparse
import sys
from pathlib import Path

try:
    import umap
except ImportError:
    print("umap-learn not installed. Install with: pip install umap-learn")
    sys.exit(1)


def compute_umap_layout(features_dir, output_path, n_neighbors=5, min_dist=0.3):
    """Compute 2D UMAP from mean MFCC vectors."""
    features_path = Path(features_dir)
    
    # Load all feature summaries
    summary_file = features_path / "_all_summaries.json"
    if summary_file.exists():
        with open(summary_file) as f:
            summaries = json.load(f)
    else:
        # Fallback: load individual feature files
        summaries = {}
        for feat_file in sorted(features_path.glob("*_features.json")):
            with open(feat_file) as f:
                data = json.load(f)
            stem = feat_file.stem.replace("_features", "")
            summaries[stem] = data["summary"]

    if len(summaries) < 3:
        print(f"Only {len(summaries)} performances found. UMAP needs at least 3.")
        print("Falling back to random 2D positions.")
        positions = {}
        for i, perf_id in enumerate(summaries.keys()):
            angle = 2 * np.pi * i / len(summaries)
            positions[perf_id] = {
                "x": float(0.5 + 0.3 * np.cos(angle)),
                "y": float(0.5 + 0.3 * np.sin(angle))
            }
    else:
        # Build MFCC matrix
        perf_ids = list(summaries.keys())
        mfcc_matrix = np.array([summaries[pid]["mfcc_mean"] for pid in perf_ids])

        print(f"Computing UMAP for {len(perf_ids)} performances...")
        print(f"  MFCC matrix shape: {mfcc_matrix.shape}")
        print(f"  Parameters: n_neighbors={n_neighbors}, min_dist={min_dist}, metric=cosine")

        try:
            reducer = umap.UMAP(
                n_components=2,
                n_neighbors=min(n_neighbors, len(perf_ids) - 1),
                min_dist=min_dist,
                metric='cosine',
                random_state=42
            )
            embedding = reducer.fit_transform(mfcc_matrix)
        except TypeError:
            # Fallback for umap/sklearn compatibility issues
            print("  UMAP failed (sklearn compatibility), falling back to PCA...")
            from sklearn.decomposition import PCA
            from sklearn.preprocessing import normalize
            mfcc_normed = normalize(mfcc_matrix, norm='l2')
            pca = PCA(n_components=2, random_state=42)
            embedding = pca.fit_transform(mfcc_normed)

        # Normalize to [0, 1] range
        embedding_min = embedding.min(axis=0)
        embedding_max = embedding.max(axis=0)
        embedding_range = embedding_max - embedding_min
        embedding_range[embedding_range == 0] = 1  # avoid division by zero
        embedding_normalized = (embedding - embedding_min) / embedding_range

        positions = {}
        for i, perf_id in enumerate(perf_ids):
            positions[perf_id] = {
                "x": float(embedding_normalized[i, 0]),
                "y": float(embedding_normalized[i, 1])
            }

    # Save output
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, 'w') as f:
        json.dump(positions, f, indent=2)

    print(f"Saved {len(positions)} positions to {output}")
    return positions


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Compute UMAP layout from audio features"
    )
    parser.add_argument(
        "--features", type=str, default="assets/features/",
        help="Directory containing feature JSON files"
    )
    parser.add_argument(
        "--output", type=str, default="assets/manifests/umap_positions.json",
        help="Output JSON file for UMAP positions"
    )
    parser.add_argument(
        "--n-neighbors", type=int, default=5,
        help="UMAP n_neighbors parameter"
    )
    parser.add_argument(
        "--min-dist", type=float, default=0.3,
        help="UMAP min_dist parameter"
    )

    args = parser.parse_args()
    compute_umap_layout(args.features, args.output, args.n_neighbors, args.min_dist)

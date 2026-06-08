# Media Assets And NAS Recovery

The repository keeps source code, metadata, and lightweight static assets in
Git. Large media files are excluded because they are high-fidelity archive
materials and can be very large.

## NAS Location

On lab machines, mount the EMPLUS Synology NAS at:

```text
/Volumes/EMPLUS-Students/
```

The Verbier archive source material is under:

```text
/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/
```

Useful subfolders:

```text
/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/
├── Rendered Deliverables/
│   Older rendered web assets: audio mixes, stems, manifests, and optional
│   video assets from previous prototype iterations.
└── verbier-1994-2022-photos/Photos/
    Photo archive used by gallery/prototype views.
```

If the NAS is not mounted, connect through Finder:

```text
Go -> Connect to Server -> smb://[nas-address]
```

## Local Runtime Folders

The current app expects large runtime files in ignored local folders:

```text
Verbier/
├── media/<piece>/
│   Piece-level audio/video/score assets served at `/lens-media`.
├── reorchestrate-poc/lens-assets/<piece>/
│   Generated analysis/control assets served at `/lens-assets`.
├── reorchestrate-poc/stems/
│   Source-separation outputs.
├── reorchestrate-poc/output/
│   Experiment outputs.
└── reorchestrate-poc/plots/
    Local analysis figures.
```

For legacy prototype assets, restore the relevant folders from
`Rendered Deliverables/` into:

```text
verbier-curator/public/assets/audio/
verbier-curator/public/assets/stems/
verbier-curator/public/assets/video/
```

Those folders are ignored by Git.

## Browser URL Mounts

`verbier-curator/vite.config.js` maps external local folders into stable
browser URLs during development:

| Browser URL | Filesystem source |
|---|---|
| `/lens-media/...` | `media/...` |
| `/lens-assets/...` | `reorchestrate-poc/lens-assets/...` |
| `/verbier-photos/...` | `/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/verbier-1994-2022-photos/Photos/...` |
| `/follow-video/...` | repository root |
| `/assets/...` | `verbier-curator/public/assets/...` |

## Fresh Machine Checklist

1. Mount the NAS at `/Volumes/EMPLUS-Students/`.
2. Clone the repository into the project-space layout, or update
   `verbier-curator/vite.config.js` if paths differ.
3. Restore or regenerate ignored runtime assets:
   - Put piece media under `media/<piece>/`.
   - Generate conducting assets with
     `reorchestrate-poc/scripts/precompute_lens.py`.
   - Restore legacy `audio/`, `stems/`, or `video/` assets only if needed.
4. Start the app:

```bash
cd verbier-curator
npm install
npm run dev
```

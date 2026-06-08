# Verbier Festival Curator

Browser-based prototypes and inventory tooling for exploring Verbier
Festival archive recordings through immersive visuals, score-following,
and gesture-driven audio mixing.

## What Is In This Repository

This repository combines three related pieces of work:

1. A **browser installation app** for presenting the Verbier Festival archive.
2. A **metadata inventory pipeline** that reconciles archive spreadsheets,
   programme data, audio records, video records, and score records.
3. A set of **offline audio-precompute experiments** that prepare analysis
   assets for the gesture-controlled conducting demo.

```text
Verbier/
├── README.md
│   Repository overview, local setup notes, and high-level walkthrough.
│
├── docs/
│   Submission-facing project notes that are useful across the app, inventory,
│   and offline analysis folders.
│
│   └── media-assets.md
│       NAS mount paths, ignored local media folders, Vite asset URL mounts,
│       and fresh-machine recovery checklist.
│
├── verbier-curator/
│   Current Vite web app. This is the main user-facing demo for the
│   installation: splash screen, role choice, gesture-controlled conducting,
│   and follow-the-conductor gallery/video view.
│
│   ├── README.md
│   │   App-specific route map, source map, and asset mount notes.
│   ├── package.json / package-lock.json
│   │   Frontend dependencies and scripts. Use `npm run dev`, `npm run check`,
│   │   and `npm run build` from this folder.
│   ├── vite.config.js
│   │   Vite config plus local static mounts for large media folders that are
│   │   intentionally not committed to Git.
│   ├── index.html
│   │   Splash entry point for the public experience.
│   ├── choose.html
│   │   Role-selection screen. Routes visitors into Become the Conductor or
│   │   Follow the Conductor.
│   ├── become-conductor.html
│   │   Main gesture-control demo. Visitors shape the music through conducting
│   │   proxy gestures.
│   ├── gesture-guide.html
│   │   Visual/tutorial reference for the gesture controls.
│   ├── follow.html
│   │   Simplified follow-the-conductor gallery/video experience.
│   ├── public/
│   │   Static files served directly by Vite.
│   │
│   │   ├── v_splash_bg.png / v_logo_transparent.png
│   │   │   Main splash and branding assets.
│   │   ├── choose-bg-follow.jpg
│   │   │   Background image for the role-choice/follow path.
│   │   ├── dattorroReverb.js
│   │   │   Browser reverb processor used by the audio experience.
│   │   ├── page-location.css
│   │   │   Shared page-level location/layout styling.
│   │   └── assets/
│   │       ├── manifests/
│   │       │   Small JSON manifests used by earlier archive/gallery views.
│   │       ├── features/
│   │       │   Precomputed feature summaries for prototype visual layouts.
│   │       └── soundfonts/
│   │           SoundFont asset used by MIDI/audio rendering experiments.
│   ├── scripts/
│   │   Offline helper scripts for preparing prototype assets: feature
│   │   extraction, UMAP layout, stem preparation, MIDI rendering, MusicXML
│   │   splitting, and related audio-data experiments.
│   └── src/
│       ├── main.js
│       │   Splash-screen controller and navigation into the role-choice page.
│       ├── splash-canvas.js
│       │   Animated/audio-reactive canvas used on the splash screen.
│       ├── style.css
│       │   Global styling for the splash page and legacy shell.
│       ├── become-conductor/
│       │   Current gesture-driven conducting module.
│       │
│       │   ├── README.md
│       │   │   Detailed module notes for the conducting experience.
│       │   ├── experience.js
│       │   │   Top-level page orchestration: UI state, camera startup,
│       │   │   audio-engine wiring, tutorial flow, and fallback controls.
│       │   ├── audio-engine.js
│       │   │   Web Audio graph and mix parameters: EQ, reverb, width,
│       │   │   compression, gain, and attack texture.
│       │   ├── gesture-to-sound.js
│       │   │   Maps hand-tracking signals to musical/audio controls.
│       │   ├── hand-camera.js
│       │   │   MediaPipe hand tracking and camera integration.
│       │   ├── live-overlay.js
│       │   │   Gesture/debug overlay rendered above the live camera feed.
│       │   ├── styles.css
│       │   │   Visual styling for the Become the Conductor page.
│       │   ├── gesture-reference.md
│       │   │   Human-readable gesture-control reference.
│       │   └── audio-controls-test.html
│       │       Standalone test bench for checking audio controls.
│       ├── shared/
│       │   Shared frontend utilities used across current and legacy modules.
│       │
│       │   ├── constants.js
│       │   │   Shared constants such as piece IDs and asset paths.
│       │   ├── transition.js
│       │   │   Page-transition helpers.
│       │   └── ui-controls.js
│       │       Reusable UI control helpers.
│       └── legacy/
│           Earlier concepts preserved for reference. These are useful for
│           understanding the design history, but they are not the current
│           presentation path.
│
│           ├── music-landscape-prototype/
│           │   Former "Breathing Verbier" / musical landscape navigation
│           │   prototype. It used feature loading, UMAP placement, audio
│           │   previews, and 3D performance entities to navigate recordings.
│           └── stem-mixing-prototype/
│               Earlier per-stem hand-mixing experiment. The current Become
│               the Conductor page reuses its gesture classifier, but the old
│               prototype route itself is legacy.
│
├── inventory/
│   Archive metadata extraction and reconciliation pipeline. It turns raw
│   archive spreadsheets and scraped programme pages into structured JSON and
│   the root SQLite database.
│
│   ├── README.md
│   │   Full pipeline documentation: data sources, stages, coverage, and run
│   │   commands.
│   ├── scripts/
│   │   ├── extraction/
│   │   │   Stage 1 and 2 scripts for parsing audio/video/score spreadsheets
│   │   │   and scraping historical Verbier programme pages.
│   │   │
│   │   │   ├── score_audio_linkage_analysis.py
│   │   │   │   Parses score/audio spreadsheets and produces normalized
│   │   │   │   metadata plus linkage reports.
│   │   │   ├── parse_video_metadata.py
│   │   │   │   Parses the video/DVD archive spreadsheet.
│   │   │   └── verbier_programme_scraper.py
│   │   │       Scrapes live and Wayback programme pages into year-level JSON.
│   │   └── reconciliation/
│   │       └── build_reconciliation_db.py
│   │           Builds the reconciled SQLite database and app-facing linkage
│   │           exports.
│   ├── programme_data/
│   │   Scraped programme JSON files by year, plus scraper summaries and URL
│   │   caches. `raw_html/` is a large regenerable cache and is ignored.
│   └── overview/
│       Reports and derived outputs used to inspect the archive linkage.
│
│       ├── dataset_exploration_report.md
│       │   Human-readable dataset analysis and strategy notes.
│       ├── sankey_diagram.md
│       │   Mermaid diagram for understanding archive linkages.
│       ├── linkage_report.json
│       │   Detailed audio/score/programme reconciliation output.
│       ├── video_audio_matches.json
│       │   Video-to-audio bridge used by app/prototype flows.
│       └── metadata/
│           Intermediate parsed JSON for audio, video, and score records.
│
├── reorchestrate-poc/
│   Offline audio-analysis and score-informed separation experiments. These
│   scripts prepare the precomputed assets consumed by the gesture-conducting
│   demo.
│
│   ├── environment.yml
│   │   Conda environment for the Python audio-analysis tooling.
│   ├── scripts/
│   │   ├── precompute_lens.py
│   │   │   Main precompute path for Become the Conductor lens assets.
│   │   ├── hpss_baseline.py
│   │   │   Harmonic/percussive source-separation baseline.
│   │   ├── score_informed_separate.py
│   │   │   Score-informed audio separation experiment.
│   │   ├── align.py / verify_score_alignment.py
│   │   │   Score/audio alignment helpers and verification.
│   │   └── pipeline.py
│   │       Pipeline wrapper for running the offline experiments.
│   ├── lens-assets/
│   │   Local generated assets served by Vite at `/lens-assets`. Ignored by
│   │   Git because the generated audio/analysis files are large.
│   ├── stems/
│   │   Local source-separation outputs. Ignored by Git.
│   ├── output/
│   │   Local experiment outputs. Ignored by Git.
│   └── plots/
│       Local analysis figures. Ignored by Git.
│
├── media/
│   Local high-fidelity audio/video/score assets grouped by piece/composer.
│   Served by the app at `/lens-media` during development. Ignored by Git.
│
├── verbier_archive.sqlite
│   Reconciled archive database generated by the inventory pipeline.
│
├── .gitignore
│   Keeps large media, generated analysis outputs, build caches, and local
│   presentation exports out of Git.
│
└── Local presentation/export artifacts
    Files such as `Prototype_.mp4`, `VerbierFestival_FinalPresentation...`,
    and `rewrite_outlook*.sh` are local presentation/export helpers rather
    than core app architecture.
```

Large archival audio/video files and generated lens assets are kept out of
Git. They are mounted locally at runtime by the Vite dev server.

The main development loop is usually:

1. Use `inventory/` when you need to refresh archive metadata or rebuild
   `verbier_archive.sqlite`.
2. Use `reorchestrate-poc/` when you need to regenerate analysis/audio assets
   for a piece.
3. Use `verbier-curator/` when you are changing the public browser
   experience.
4. Treat `verbier-curator/src/legacy/` as design history unless you are
   intentionally reviving an older prototype.

## Media And NAS Asset Locations

The GitHub repository is intentionally code-first. The high-fidelity media
assets are too large for Git and include copyrighted Verbier Festival archive
materials, so they live on the EMPLUS Synology NAS and in ignored local working
folders.

On the lab machines, the NAS is expected to be mounted at:

```text
/Volumes/EMPLUS-Students/
```

The main source archive is:

```text
/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/
```

Important NAS subfolders:

```text
/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/
├── Rendered Deliverables/
│   Rendered audio mixes, stems, manifests, and other prepared web assets
│   from earlier pipeline iterations.
└── verbier-1994-2022-photos/Photos/
    Verbier Festival photo archive used by gallery/prototype views.
```

Important ignored local working folders inside this project:

```text
Verbier/
├── media/
│   Local piece-level audio/video/score assets used by the current demo.
│   Expected shape: `media/<piece>/...`, for example `media/Mozart_40/...`.
├── reorchestrate-poc/lens-assets/
│   Generated analysis and audio-control assets for Become the Conductor.
│   Expected shape: `reorchestrate-poc/lens-assets/<piece>/...`.
├── reorchestrate-poc/stems/
│   Local source-separation outputs.
├── reorchestrate-poc/output/
│   Local experiment outputs.
└── reorchestrate-poc/plots/
    Local analysis figures.
```

During local development, `verbier-curator/vite.config.js` exposes those
external folders through stable browser URLs:

| Browser URL | Filesystem source | Purpose |
|---|---|---|
| `/lens-media/...` | `media/...` | Current piece media used by the conducting demo |
| `/lens-assets/...` | `reorchestrate-poc/lens-assets/...` | Generated lens/precompute assets |
| `/verbier-photos/...` | `/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/verbier-1994-2022-photos/Photos/...` | NAS photo archive |
| `/follow-video/...` | repository root | Local presentation/demo videos when needed |
| `/assets/...` | `verbier-curator/public/assets/...` | Small tracked manifests/features plus optional legacy audio/stem/video folders |

For reproducibility on a fresh machine:

1. Mount the NAS at `/Volumes/EMPLUS-Students/`.
2. Clone this repository into the same project-space layout, or update
   `verbier-curator/vite.config.js` if your local paths differ.
3. Restore or regenerate ignored runtime assets:
   - Use `reorchestrate-poc/scripts/precompute_lens.py` to rebuild
     `reorchestrate-poc/lens-assets/<piece>/`.
   - Place piece media under `media/<piece>/`.
   - For older prototype assets, see `docs/media-assets.md` and restore the
     relevant `audio/`, `stems/`, `video/`, or manifest folders from
     `Rendered Deliverables/` into `verbier-curator/public/assets/`.
4. Start the app from `verbier-curator/` with `npm run dev`.

See `docs/media-assets.md` for the full media recovery notes around NAS paths
and rendered deliverables.

## Frontend App Walkthrough

```bash
cd verbier-curator
npm install
npm run dev
```

Open the local app at:

- `http://127.0.0.1:5173/` - splash entry
- `http://127.0.0.1:5173/choose.html` - role choice
- `http://127.0.0.1:5173/become-conductor.html` - gesture-driven conducting demo
- `http://127.0.0.1:5173/follow.html` - conductor-following view

Current user-facing flow:

1. `index.html` shows the Verbier splash screen.
2. `choose.html` lets visitors choose a role.
3. `become-conductor.html` opens the gesture-controlled mixing experience.
4. `follow.html` opens the simplified follow-the-conductor gallery/video view.
5. Earlier landscape-navigation and stem-mixing experiments are preserved under
   `verbier-curator/src/legacy/` for reference, but they are not the current
   presentation path.

See `verbier-curator/README.md` for the app module map and asset mount
details.

## Inventory Pipeline

The `inventory/` folder reconciles festival programme data, audio records,
video records, and score metadata into structured JSON and SQLite outputs.

See `inventory/README.md` for pipeline stages, scripts, and data coverage.

## Audio Precompute

The `reorchestrate-poc/scripts/` folder contains offline experiments and
precompute utilities. The Become the Conductor demo expects precomputed
assets under:

```text
reorchestrate-poc/lens-assets/<piece>/
media/<piece>/
```

Those asset folders are intentionally ignored by Git because they contain
large audio/video files. `verbier-curator/vite.config.js` serves them via
explicit external static mounts during local development.

## Repository Hygiene

Tracked:

- Frontend source, HTML entries, styles, static UI images, app docs
- Inventory scripts and structured metadata JSON
- Offline precompute scripts

Ignored:

- `node_modules/`, `dist/`, `.vite/`
- Audio/video assets (`*.wav`, `*.mp3`, `*.mp4`, etc.)
- Generated HPSS/lens assets and source-separation outputs
- Local assistant/cache folders and exported presentation HTML

## Verification

```bash
cd verbier-curator
npm run check
npm run build
```

`npm run build` may fail on machines where the ignored large media folders
or external NAS mounts are unavailable. `npm run check` is the lightweight
syntax check for the tracked JavaScript modules.

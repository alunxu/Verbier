# Verbier Festival Curator

Browser-based prototypes and inventory tooling for exploring Verbier
Festival archive recordings through immersive visuals, score-following,
and gesture-driven audio mixing.

## What Is In This Repository

```text
Verbier/
├── verbier-curator/       # Vite frontend app and browser demos
├── inventory/             # Archive metadata extraction/reconciliation pipeline
├── reorchestrate-poc/     # Offline audio-analysis and HPSS precompute scripts
├── verbier_archive.sqlite # Reconciled archive database used by analysis/app flows
└── data source.md         # Local/NAS data source notes
```

Large archival audio/video files and generated lens assets are kept out of
Git. They are mounted locally at runtime by the Vite dev server.

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

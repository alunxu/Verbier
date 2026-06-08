# Verbier Curator App

Vite frontend for the Verbier Festival interactive archive prototypes.

## Entry Points

| Route | Purpose |
|---|---|
| `/` | Splash screen and entry into the experience |
| `/choose.html` | Role choice: Become the Conductor / Follow the Conductor |
| `/lens-app.html` | Music Lens gesture-control demo |
| `/lens-instructions.html` | Gesture-control documentation screen |
| `/follow.html` | Score/conductor-following view |

## Source Map

```text
src/
├── main.js                 # Splash and original landscape/re-orchestrate shell
├── splash-canvas.js        # Audio-reactive splash background
├── style.css               # Shared styles for the original shell
├── breathing-verbier/      # 3D landscape and archive navigation
├── re-orchestrate/         # Earlier stem-mixing prototype
├── music-lens/             # Current gesture-driven mixing demo
└── shared/                 # Shared constants, UI helpers, transitions
```

`src/music-lens/` is the main demo used for gesture-controlled mixing. Its
own README explains the Web Audio graph, gesture mapper, and fallback UI.

## Local Development

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

The app serves large local media through Vite middleware instead of storing
them in the repository.

## Asset Mounts

Configured in `vite.config.js`:

| URL prefix | Local source |
|---|---|
| `/lens-assets` | `../reorchestrate-poc/lens-assets` |
| `/lens-media` | `../media` |
| `/verbier-photos` | `../../Datasets/Verbier Archive/verbier-1994-2022-photos/Photos` |
| `/follow-video` | repository root |

These local folders are intentionally not committed to GitHub.

## Checks

```bash
npm run check
npm run build
```

Use `npm run check` before quick commits. `npm run build` is useful when
the local media/NAS environment is available; it can fail with filesystem
I/O errors if large ignored assets are missing or temporarily unavailable.

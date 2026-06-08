# Verbier Curator App

Vite frontend for the Verbier Festival interactive archive prototypes.

## Entry Points

| Route | Purpose |
|---|---|
| `/` | Splash screen and entry into the experience |
| `/choose.html` | Role choice: Become the Conductor / Follow the Conductor |
| `/become-conductor.html` | Gesture-control experience for shaping a performance mix |
| `/gesture-guide.html` | Gesture-control documentation screen |
| `/follow.html` | Score/conductor-following view |

## Experience Walkthrough

1. **Splash** (`index.html`) introduces the Verbier Festival archive.
2. **Choose a role** (`choose.html`) routes visitors into one of two current
   presentation paths.
3. **Become the Conductor** (`become-conductor.html`) lets visitors use hand
   gestures as a conducting proxy. Gestures control mix-level parameters such
   as EQ, reverb, stereo width, compression, master gain, and attack texture.
4. **Follow the Conductor** (`follow.html`) keeps the interaction simpler: a
   gallery/video-led view for following a performance.
5. **Legacy prototypes** live under `src/legacy/`. They are useful context but
   are not the current demo route.

## Source Map

```text
src/
├── main.js                 # Splash entry and route into the role-choice page
├── splash-canvas.js        # Audio-reactive splash background
├── style.css               # Splash and legacy shell styles
├── become-conductor/       # Current gesture-driven conducting experience
├── legacy/                 # Earlier prototypes kept for reference
│   ├── music-landscape-prototype/  # Previous 3D music-landscape navigation concept
│   └── stem-mixing-prototype/ # Previous per-stem hand-mixing experiment
└── shared/                 # Shared constants, UI helpers, transitions
```

`src/become-conductor/` is the main demo used for gesture-controlled
conducting. Its own README explains the Web Audio graph, gesture mapper,
and fallback UI.

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

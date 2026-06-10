# Verbier Curator Demo

This folder is the local NAS demo handoff for the Verbier Festival Curator.

The demo is not deployed online because the project uses copyrighted Verbier
Festival archive media. It should be run locally from this NAS project folder.

## Quick Start

From the project root:

```bash
./demo/run-demo.sh
```

Or double-click:

```text
RUN_DEMO.command
```

Then open:

```text
http://127.0.0.1:5173/
http://127.0.0.1:5173/choose.html
```

Recommended path for the reviewer:

1. Open `choose.html`.
2. Choose **Become the Conductor** for the gesture-controlled experience.
3. Choose **Follow the Conductor** for the gallery/video-led view.

## Prerequisites

- Node.js installed.
- The project folder available on the NAS/current machine.
- The local media folders preserved in this project directory:
  - `media/`
  - `reorchestrate-poc/lens-assets/`
  - `verbier-curator/public/assets/audio/` and `verbier-curator/public/assets/stems/`

The static demo server only requires Node.js. It does not require
`npm install` or `node_modules`.

## NAS / VPN Performance Note

The demo reads large audio and video files from this NAS project folder. If the
NAS is mounted over VPN or a slow remote connection, the first page load and
the first media seek may feel slow. For the smoothest review experience, run
the demo from a campus/local network connection to the NAS, or copy this whole
project folder to a local disk first and run the same `./demo/run-demo.sh`
command there.

## Preflight Check

Run:

```bash
./demo/check-demo.sh
```

This checks the expected app files, Node, key media folders, and whether a
server is already responding on the configured port.

## Port

The default URL is:

```text
http://127.0.0.1:5173/
```

If port `5173` is busy:

```bash
PORT=5174 ./demo/run-demo.sh
```

Then open:

```text
http://127.0.0.1:5174/
```

## Important Asset Locations

The local static demo server serves large media through explicit local mounts:

| Browser URL | Local folder |
|---|---|
| `/lens-media/...` | `media/...` |
| `/lens-assets/...` | `reorchestrate-poc/lens-assets/...` |
| `/verbier-photos/...` | `/Volumes/EMPLUS-Students/CDS 2026/Datasets/Verbier Archive/verbier-1994-2022-photos/Photos/...` |
| `/follow-video/...` | project root |
| `/assets/...` | `verbier-curator/public/assets/...` |

## Troubleshooting

- **Port already in use:** run with `PORT=5174 ./demo/run-demo.sh`.
- **Missing npm dependencies:** the static demo server does not require
  `node_modules`. If you want to use Vite development mode manually, run
  `cd verbier-curator && npm install`.
- **Blank media/video:** run `./demo/check-demo.sh` and confirm that `media/`
  and `reorchestrate-poc/lens-assets/` exist in this project folder.
- **Browser asks for camera permission:** allow camera access for the gesture
  experience. The fallback sliders still work without a camera.

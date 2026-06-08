# Become the Conductor

Real-time gestural reorchestration of Verbier Festival recordings using
hand tracking and Web Audio effects — no source separation at runtime.

Built as the curator's "Mode B" alternative to per-instrument stem mixing,
because classical orchestral source separation from a stereo mixdown is
fundamentally limited (timpani / low strings overlap in time, frequency,
and stereo image — they cannot be cleanly split). The gesture-mixing approach
treats the mix as sacred and reshapes it through a focused chain of
audio effects: 3-band EQ, stereo width, reverb, compressor, and an
HPSS-based melody/rhythm balance.

**See also**: [`gesture-reference.md`](gesture-reference.md) — practical cheat-sheet
matching every gesture to the AudioParam it touches and the file/line
where you'd tune it.

## What Visitors Experience

1. Choose a musical excerpt.
2. Complete a short gesture tutorial.
3. Watch the live performance video while using hands to shape the sound.
4. Hear immediate changes in tone, space, dynamics, attack, and loudness.
5. Fall back to sliders if camera access is unavailable.

The interaction is intentionally a conducting proxy: gestures do not edit
the score, tempo, or notes. They control expressive mixing parameters that
make the recording feel responsive.

## Quick start

```bash
cd verbier-curator
npm install            # if not already done
npm run dev            # starts Vite at http://localhost:5173
```

Then open:

- [http://localhost:5173/become-conductor.html](http://localhost:5173/become-conductor.html) — the demo
- [http://localhost:5173/gesture-guide.html](http://localhost:5173/gesture-guide.html) — full documentation
- [http://localhost:5173/src/become-conductor/audio-controls-test.html](http://localhost:5173/src/become-conductor/audio-controls-test.html) — slider-only test bench

If a webcam isn't available or permission is denied, the app falls back
to slider-only control. Four mood presets work either way.

## Files

| File | Role |
|---|---|
| `audio-engine.js` | Web Audio effect graph and 3-source playback (mix + harmonic + percussive in sync). Exposes 8 setter methods + 4 presets. |
| `hand-camera.js` | Minimal MediaPipe Hands wrapper. Calls a callback with `(hands, gestures)` per frame. |
| `gesture-to-sound.js` | Maps hand landmarks to the 8 effect parameters with adaptive calibration and EMA smoothing. |
| `live-overlay.js` | Canvas overlay drawing hand skeletons, parameter HUD, VU meter. |
| `experience.js` | App orchestrator and state machine (welcome → picker → loading → calibration → demo). |
| `styles.css` | All app styling. |
| `audio-controls-test.html` | Standalone slider test bench (for engine debugging). |

In `verbier-curator/` (root level):

- `become-conductor.html` — full demo entry point (welcome / picker / demo screens)
- `gesture-guide.html` — standalone documentation page

## Pre-computed assets

Each piece needs three audio files (mix / harmonic / percussive) and a
`manifest.json`. Generate them via the offline pre-compute script:

```bash
python ../../reorchestrate-poc/scripts/precompute_lens.py \
    ../../media/Mozart/VIDEO_AUDIO/Mozart_audio.mp3 \
    --out-dir ../../reorchestrate-poc/lens-assets/Mozart \
    --name "Mozart_DonGiovanni_Overture" \
    --video ../../media/Mozart/VIDEO_AUDIO/Mozart_Video.mp4
```

(See `precompute_lens.py --help` for full args.)

The runtime expects assets at `/lens-assets/<piece>/...` URLs. Vite is
configured (in `vite.config.js`) with a custom static-mount middleware
that serves `reorchestrate-poc/lens-assets/` and `media/` from outside
the project root — so no copying or symlink mirroring is required.

## The 8-parameter effect chain

```
sources ─ mix     ┐
        ─ harmon. ├──→ source-mix → eqLow → eqMid → eqHigh
        ─ percus. ┘                                    │
                                                       ▼
                                                  compressor
                                                       │
                                  ┌──── dry ────┐      ▼
                                  │             ▼   M/S width
                                  └──→ convolver-wet  │
                                          │           │
                                          └──→ reverb-mix → master → out
```

| Effect | Web Audio node | Range |
|---|---|---|
| EQ Low | `BiquadFilter` (lowshelf @ 350 Hz) | 0 or +24 dB from left fist |
| EQ Mid | `BiquadFilter` (peaking @ 1 kHz, Q=0.5) | ±24 dB |
| EQ High | `BiquadFilter` (highshelf @ 4 kHz) | ±24 dB |
| Stereo Width | M/S processing via splitter + 4 cross-coefficients | 0=mono, 1=original, 3=very wide |
| Reverb | **Dattorro plate-reverb AudioWorklet** ([khoin/DattorroReverbNode](https://github.com/khoin/DattorroReverbNode), public domain) | 0–100% wet, decay+pre-delay automated |
| HPSS Mix | crossfade between mix / harmonic / percussive sources | 0=percussive, 0.5=mix, 1=harmonic |
| Compressor | `DynamicsCompressor` with synced threshold + ratio | 0=off, 1=heavy |
| Master | `GainNode` | 0.15–1.5× effective output |

Every parameter setter uses `setTargetAtTime(value, ctx.currentTime, 0.02)`
to avoid clicks when sliders are dragged or when gestures swing rapidly.

## Gesture vocabulary

The conductor metaphor: **left hand shapes the sound**, **right hand
shapes the space**, **both hands together control the overall feel**.

| Hand | Input | Effect | Range |
|---|---|---|---|
| Left | Wrist y (height) | EQ High | normalized to ±24 dB |
| Left | Wrist x (left/right) | EQ Mid | ±24 dB symmetric around center |
| Left | Fist closed/open | EQ Low | open=0 dB, closed=+24 dB |
| Right | Wrist y | Reverb wet | 0–100% gesture amount |
| Right | Wrist x | Stereo width | 0–3 |
| Right | Fist closed/open | HPSS mix | open=0.5 (mix), closed=1.0 (harmonic) |
| Both | Average wrist y | Master gain | 0.15–1.5 effective output |
| Both | Hand closeness | Compressor amount | 0–100% |

### Adaptive calibration

The mapper tracks min/max of wrist x, y, and hand spread over time. Bounds
expand immediately when the user reaches past, then slowly decay back
toward neutral so the mapping doesn't permanently over-stretch from a
one-off gesture. There's also an explicit calibration step in the
welcome flow where the user spreads their arms wide for 3 seconds.

### Smoothing

Two layers of smoothing prevent jitter from MediaPipe noise or hand tremor:

1. The hand tracker EMA-smooths the raw 21 landmarks (alpha = 0.45).
2. The gesture mapper EMA-smooths the derived 8 parameters (alpha = 0.35).
3. The audio engine adds a 20 ms `setTargetAtTime` ramp on every parameter set.

Total perceived latency: ~50 ms — below the threshold of audible delay.

## Presets

```js
Original    : EQ flat, dry, normal width
ConcertHall : EQ +1/0/+1 dB, 55% reverb, width 1.3, mild compression
Cinematic   : EQ +5/-1/+2 dB, 70% reverb, width 1.5, strong compression
Intimate    : EQ -2/+3/0 dB, 15% reverb, width 0.5, dry mid-focused
```

Clicking a preset pauses gesture control for 2 seconds so the mapper
doesn't immediately overwrite the preset values back to gesture-driven
ones. After 2 seconds, the gestures resume from the preset's parameters.

## Architecture notes

### Why pre-compute HPSS?

Harmonic / percussive separation runs in ~30 seconds per piece via
librosa on a Mac. Doing it in the browser would require WASM-compiled
DSP and add seconds of latency on each piece change. Pre-computing
once produces three lightweight WAV files that the browser loads in
parallel and plays in sync.

The HPSS knob then becomes a simple crossfade between three audio
sources — no real-time DSP needed.

### Audio / video sync

Audio is the master clock. Every 250 ms a timer reads
`engine.getCurrentTime()` (computed from `AudioContext.currentTime`)
and corrects the video's `currentTime`:

- drift > 0.4 s: hard re-seek
- drift > 0.08 s: nudge `playbackRate` by ±4%
- otherwise: `playbackRate = 1.0`

The video element is muted; only the audio engine produces sound.

### Symlinks vs middleware

Initial attempt used a symlink (`public/lens-assets → ../../reorchestrate-poc/lens-assets`)
but Vite's dev server didn't follow symlinks reliably across the NAS
mount. Replaced with a custom Vite plugin (`externalStaticMounts`) that
explicitly serves the two external directories. See `vite.config.js`.

## Known limitations

- **Reverb is algorithmic plate, not a real hall convolution.** The Dattorro
  AudioWorklet gives studio-quality plate-reverb character — modulated,
  diffuse, smooth — which sounds great for orchestral material but isn't
  the same as convolving with a real concert hall IR. Adding multi-IR
  switching (e.g. Boston Symphony Hall, Verbier Église) via ConvolverNode
  is a possible future enhancement.
- **HPSS reconstruction loss.** With `margin=3.0` (strict separation),
  H + P does not exactly reconstruct the original — some "ambiguous"
  frequency content is discarded. Ratio = 0.5 plays the original mix
  directly to avoid this, but moving the slider toward 0 or 1 reveals
  a dimmer, slightly thin version of the mix. Lowering margin to 1.0
  improves reconstruction at the cost of separation purity.
- **Beethoven piece is only 60 s.** The provided `Beethoven_video.mp4`
  has a 4-second video stream but a 60-second audio stream. The current
  lens treats it as 60 s of audio with the looped video. Replacing
  the file with a properly-encoded 60-second video would polish this.
- **Gesture mapping is symmetric.** Left/right are visually distinguished
  but functionally the same approach (height + side + fist). For more
  expressive demos, additional gestures (pinch, point, rotate) could
  drive more parameters. Adding them is a matter of extending
  `gesture-mapping.js` and `gesture-to-sound.js`.
- **No test for handsAcrossBody.** When users cross their hands
  mid-performance (visually intuitive for "swap"), MediaPipe usually
  re-classifies them — but the current mapper treats this as a normal
  position update. Adding a "cross" gesture as a preset trigger is
  straightforward.

## Self-evaluation tested in browser

The following were verified via Claude_Preview tooling against the
running dev server:

- ✅ Welcome screen renders, gesture cards display, all 3 buttons present
- ✅ Picker screen renders, 3 piece cards
- ✅ Loading screen advances to demo when buffers decode
- ✅ Demo screen: video plays, header shows composer/title, HUD shows 8 params
- ✅ All 8 sliders drive the engine's AudioParams
- ✅ All 4 presets correctly set engine + mapper + sliders
- ✅ Pause/Play toggles both engine and video
- ✅ "Choose another piece" returns to picker, switching loads the new piece
- ✅ Instructions page renders with full documentation, back link works
- ✅ HPSS mix correctly crossfades the three audio sources
- ✅ Stereo width's M/S processing produces correct cross-coefficients
- ✅ No console errors during normal flow

The webcam path was tested via the no-camera fallback (the headless
preview always denies camera access). Real webcam + MediaPipe testing
must be done on a physical machine — see "Manual checks" below.

## Manual checks (require physical machine)

These were not testable from the headless preview tool:

- Camera permission prompt and acceptance
- MediaPipe Hands actual detection on a real webcam feed
- Hand skeleton overlay drawing on the canvas
- Adaptive calibration (3-second arm-spread)
- Real-time gesture → audio responsiveness
- Cross-platform Bluetooth audio latency

## Future work

- AudioWorklet-based pitch shifter so a 9th gesture can transpose
- Per-piece preset overrides (e.g. Haydn defaults heavier on the voices stem)
- Touch fallback for tablet without webcam
- Recording mode: capture the gesture-driven mix as a new audio file
- Multi-camera support for studio installation

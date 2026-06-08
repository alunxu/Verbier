# Music Lens · Gesture Reference

A practical cheat-sheet matching every gesture to the effect it controls,
the AudioParam it touches in [`lens-engine.js`](lens-engine.js), and the
code path that translates one to the other.

Use this side-by-side with the app while testing — every row tells you
**exactly where to look** if a gesture feels off.

---

## At a glance

```
                          ┌──────────────────────────┐
                          │     CAMERA / WEBCAM      │
                          │   (mirrored on screen)   │
                          └──────────┬───────────────┘
                                     │
                                     ▼
              ┌──────────────────────────────────────────┐
              │     Frame as the user sees it (mirror)   │
              │                                          │
              │   ⌘ LEFT HAND                RIGHT HAND ⌘│
              │     ↕  EQ High                Reverb  ↕  │
              │     ↔  EQ Mid               Width   ↔   │
              │     ✊  EQ Low (boost)        HPSS  ✊   │
              │                                          │
              │   ── BOTH HANDS ─────────────────────── │
              │   avg ↕  → Master volume (crescendo)    │
              │   spread ↔ → Compressor amount          │
              └──────────────────────────────────────────┘
```

`⌘` marks the dominant role: **left = sound shape**, **right = sound space**.

---

## The eight effect parameters

Each row maps a single user gesture to a single engine setter. The "Code"
column points at the exact line in
[`lens-gesture-mapper.js`](lens-gesture-mapper.js) where the value is
written; the "Engine" column points at
[`lens-engine.js`](lens-engine.js).

| # | Effect | Triggered by | Range (gesture) | Range (effect) | Engine setter | Mapper section |
|---|---|---|---|---|---|---|
| 1 | **EQ Low** (lowshelf @ 350 Hz) | Left fist closed/open | discrete: closed / open | open=0 dB &nbsp; closed=+24 dB | `setEqLow(db)` | "Left hand" / fist |
| 2 | **EQ Mid** (peaking @ 1 kHz, Q=0.5) | Left hand x (side-to-side) | normalized 0..1 | symmetric ±24 dB | `setEqMid(db)` | "Left hand" / xN |
| 3 | **EQ High** (highshelf @ 4 kHz) | Left hand y (height) | normalized 0..1 | -24 dB (low) → +24 dB (high) | `setEqHigh(db)` | "Left hand" / yUp |
| 4 | **Reverb wet** (Dattorro plate AudioWorklet) | Right hand y (height) | normalized 0..1 | 0 (dry) → 1.0 (wet=0.55, dry=0.4, decay=0.85) | `setReverbWet(0..1)` | "Right hand" / yUp |
| 5 | **Stereo width** (M/S) | Right hand x (side-to-side) | normalized 0..1 | 0.0 (mono) → 3.0 (very wide) | `setStereoWidth(0..3)` | "Right hand" / xN |
| 6 | **HPSS mix** | Right fist closed/open | discrete: closed / open | open=0.5 (mix) &nbsp; closed=1.0 (harmonic only) | `setHpssMix(0..1)` | "Right hand" / fist |
| 7 | **Master gain** | Both hands' average y | normalized 0..1 | 0.15 (low) → 1.5 effective output | `setMasterGain(0..1.5)` | "Both hands" / avg y |
| 8 | **Compressor amount** | Closeness between two wrists | normalized 0..1 | 0 (no comp) → 1.0 (heavy) | `setCompressor(0..1)` | "Both hands" / closeness |

> **Default neutral pose** (when no hands are detected for >0.5 s) is
> `eq=0,0,0 / reverb=0 / width=1.0 / hpss=0.5 / comp=0 / master=0.85` —
> i.e. exactly the `Original` preset. The mapper smoothly glides back to
> these values during dropouts so a brief detection failure doesn't
> produce a sound jolt.

---

## What "fist closed" actually means

[`gesture-mapping.js`](../re-orchestrate/gesture-mapping.js) uses a
finger-fold heuristic:

> A fist is registered when **at least 3 of the 4 main fingers** (index,
> middle, ring, pinky) have their tip pulled closer to the wrist than
> their MCP knuckle, scaled by 1.25× (to allow for natural finger angles).

[`lens-gesture-mapper.js`](lens-gesture-mapper.js) further debounces this
by requiring **3 consecutive frames** of the same state to flip — so
quick finger flicks won't toggle the EQ Low boost or HPSS jump.

---

## What "hand height" actually maps from

The mapper uses **wrist Y in the normalized image** (MediaPipe coords:
0 = top of frame, 1 = bottom). Then it normalizes to the user's
**learned range**:

```
yN  = (wristY − bounds.yMin) / (bounds.yMax − bounds.yMin)   // 0..1
yUp = 1 − yN                                                // up = max
```

`bounds` are adapted continuously:

- **Expand instantly** when the user reaches past current bounds.
- **Decay slowly** back toward `[0.30, 0.80]` so a one-off stretch
  doesn't permanently widen the range.

After the welcome-screen calibration ("spread your arms wide for 3
seconds"), `bounds` get explicitly seeded from what was observed.

The same scheme applies to wrist X (left ↔ right) and hand spread.

---

## Two-handed gestures

| Gesture | Detection | Effect |
|---|---|---|
| **Crescendo** | both wrists rise together | master gain → 1.2 |
| **Diminuendo** | both wrists fall together | master gain → 0.4 |
| **Pull together** | hands move toward each other | compressor amount ↑ |
| **Pull apart** | hands move away from each other | compressor amount → 0 |

Left/right interactions are independent of the two-handed layer — you
can freely shape the sound with one hand while controlling master/comp
with both.

---

## Smoothing chain (why responses feel "buttery", not jittery)

Three independent EMAs keep things stable:

```
MediaPipe raw landmarks   ──┐ EMA α=0.45  (in lens-hand-tracker._smooth)
                            ▼
Smoothed landmarks ─────────┐ classifyGestures (no smoothing)
                            ▼
8 mapper params ────────────┐ EMA α=0.35  (in lens-gesture-mapper.update)
                            ▼
Engine setter calls ────────┐ setTargetAtTime, τ=0.02s  (in lens-engine)
                            ▼
AudioParam glide
```

End-to-end perceived latency: **~50 ms** — below human audible-delay
threshold in real-time audio. Every layer is tunable in code if you
want snappier (higher α, lower τ) or smoother (lower α, higher τ)
behavior.

---

## Gesture suspension cases

| When | What happens | Why |
|---|---|---|
| User drags a slider | Gesture control disabled for **2 s** after last touch | So sliders and gestures don't fight |
| User clicks a preset | Same: 2 s suspension | Preset values get to "settle" before gestures resume |
| No hands detected for >500 ms | All 8 params relax toward neutral | Avoids parameters freezing on the last seen pose |
| Camera permission denied | Gesture mapper never runs; sliders are sole controls | App falls back automatically |

---

## Tuning guide — where to edit parameters

Want to change how aggressive a gesture is? Almost everything is one
constant in one file:

| What | Where | Effect of larger value |
|---|---|---|
| **EQ ±dB range** | `lens-gesture-mapper.js` line ~37 (`opts.eqRange`) | More dramatic high/mid/low boost |
| **Reverb max** | `opts.reverbRange[1]` | Wetter at full reach |
| **Width min/max** | `opts.widthRange` | More extreme stereo collapse / wide |
| **Master min/max** | `opts.masterRange` | Bigger crescendo range |
| **Compressor max** | `opts.compRange[1]` | Heavier compression at max hand closeness |
| **Mapper smoothing α** | `lens-gesture-mapper.js` `EMA_ALPHA` const | Higher = more reactive (less smooth) |
| **Tracker landmark α** | `shared/constants.js` `GESTURE.emaAlpha` | Higher = jitterier but lower latency |
| **Engine ramp τ** | `lens-engine.js` `SMOOTHING` const | Higher = silkier glides, more lag |
| **Fist debounce frames** | `lens-gesture-mapper.js` `FIST_HYSTERESIS_FRAMES` | Higher = harder to accidentally trigger |
| **Bounds-decay rate** | `lens-gesture-mapper.js` `_adaptBounds` | Higher = bounds shrink back faster |

---

## What the HUD on the demo screen shows

Top-right corner during `demo`:

```
┌─────────────────────────────────┐
│ EQ Low      0.0 dB              │  ← color-coded: red = boost, blue = cut
│ EQ Mid      0.0 dB              │
│ EQ High     0.0 dB              │
│ Reverb      0%                  │
│ Width       1.00                │
│ HPSS        0.50                │
│ Compress    0%                  │
│ Master      85%                 │
└─────────────────────────────────┘
```

These are the **current smoothed values** the engine is rendering
right now (post-EMA, pre-AudioParam-ramp). They reflect both gesture
input and slider input.

---

## Quick-troubleshoot

| Symptom | Most likely cause | First check |
|---|---|---|
| HUD doesn't change as I move | Either gesture suspension is active or hands aren't being detected | Look at FPS counter in bottom-right; should be ~25-30. If 0, MediaPipe failed; check console. |
| Effect changes too coarsely | Mapper EMA too low (too reactive) | Increase `EMA_ALPHA` in `lens-gesture-mapper.js` |
| Audio click/pop on big gesture | Engine ramp too short | Increase `SMOOTHING` constant in `lens-engine.js` |
| Fist gesture flickers | Hand pose ambiguous | Increase `FIST_HYSTERESIS_FRAMES`. |
| HPSS knob doesn't sound dramatic | Strict HPSS lost middle content | Re-run `precompute_lens.py --margin 1.0` for softer separation |
| Stereo width has no effect | Output is mono (e.g. Bluetooth speaker in mono) | Test with stereo headphones |

---

## When you're ready to extend

The mapper is structured so adding a 9th gesture takes ~10 lines:

1. In [`gesture-mapping.js`](../re-orchestrate/gesture-mapping.js), add a
   new field to the `result` object in `classifyGestures()` — e.g. a
   pinch detector returning a 0..1 value.
2. In [`lens-gesture-mapper.js`](lens-gesture-mapper.js) `update()`, read
   that field and write to a new `target.<param>` slot.
3. In [`lens-engine.js`](lens-engine.js), add the corresponding setter
   (e.g. `setPitch(semitones)` if introducing pitch shift via an
   `AudioWorkletNode`).
4. In [`lens-overlay-renderer.js`](lens-overlay-renderer.js)
   `_drawParamHUD`, add a row.
5. In [`lens-app.js`](lens-app.js) `_bindSliders` + the HTML, add a
   slider so it has a fallback.

Total surface: ~5 small edits in 5 files.

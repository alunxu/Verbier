/**
 * gesture-to-sound.js — Map MediaPipe hand landmarks to 8 effect parameters.
 *
 * Mapping ("conductor metaphor"):
 *   LEFT HAND  = "shape of sound"
 *     - y (height)   → High EQ gain
 *     - x (left/right) → Mid EQ gain
 *     - fist         → Low EQ gain (closed = bass boost)
 *   RIGHT HAND = "space of sound"
 *     - y (height)   → Reverb wet
 *     - x (left/right) → Stereo width
 *     - fist         → HPSS mix (closed = harmonic-only)
 *   BOTH HANDS together
 *     - avg height   → Master gain (crescendo)
 *     - hand closeness → Compressor amount
 *
 * Calibration: instead of assuming a fixed reach range, we adapt min/max y
 * and x to the user's actual range over time (slow expansion + slight decay
 * back toward neutral so people of different sizes work without setup).
 *
 * Smoothing: each effect parameter is exponentially smoothed before sending
 * to the engine. The engine adds another 20ms ramp on top of that.
 */

import { HAND_LANDMARKS } from '../shared/constants.js';

const EMA_ALPHA = 0.35;          // 0..1, larger = more reactive
const FIST_HYSTERESIS_FRAMES = 3; // require N stable frames to flip fist state

export class LensGestureMapper {
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.opts = Object.assign({
      eqRange: [-24, 24],         // dB — pushed further for unmistakable tonal shifts
      reverbRange: [0, 1.0],
      widthRange: [0.0, 3.0],     // 0 = mono, 1 = original, 3 = very wide
      hpssOpen: 0.5,
      hpssClosed: 1.0,
      compRange: [0, 1.0],        // up to maximum dynamics control
      masterRange: [0.15, 1.8],   // bigger crescendo span
    }, opts);

    // Adaptive bounds (user's reach), seeded with neutral values
    this.bounds = {
      yMin: 0.25, yMax: 0.85,
      xMin: 0.15, xMax: 0.85,
      spreadMin: 0.05, spreadMax: 0.6,
    };

    // EMA-smoothed effect targets
    this.smoothed = {
      eqHigh: 0, eqMid: 0, eqLow: 0,
      reverb: 0, width: 1.0, hpss: 0.5, comp: 0, master: 0.85,
    };

    // Fist debounce
    this.fistHistoryL = [];
    this.fistHistoryR = [];
    this.fistStateL = false;
    this.fistStateR = false;

    // Track whether we've seen any hand recently — if not, smoothly relax
    this.lastHandSeen = 0;
    this.relaxationActive = false;

    this.enabled = true;
  }

  setEnabled(b) { this.enabled = b; }

  /**
   * Push a frame of detection results. Should be called at ~30fps.
   * @param {Object} hands - { Left: landmarks[], Right: landmarks[] }
   * @param {Object} gestures - output of classifyGestures()
   */
  update(hands, gestures) {
    if (!this.enabled) return;
    const now = performance.now();
    const hasAny = !!(hands.Left || hands.Right);
    if (hasAny) this.lastHandSeen = now;

    // Adapt bounds (slow expansion, light decay to neutral)
    this._adaptBounds(hands);

    // Compute target effect values from current frame
    const target = { ...this.smoothed };

    if (hands.Left) {
      const wrist = hands.Left[HAND_LANDMARKS.WRIST];
      const yN = this._normY(wrist.y);   // 0=top, 1=bottom
      const xN = this._normX(wrist.x);   // 0=left, 1=right
      const yUp = 1 - yN;
      target.eqHigh = lerp(yUp, this.opts.eqRange[0], this.opts.eqRange[1]);
      // x maps to mid EQ symmetric: 0.5 → 0 dB, edges → ±max
      target.eqMid = lerp((xN - 0.5) * 2, this.opts.eqRange[0], this.opts.eqRange[1]);
      const newL = this._debounceFist(this.fistHistoryL, gestures.leftFistClosed);
      if (newL !== undefined) this.fistStateL = newL;
      target.eqLow = this.fistStateL
        ? this.opts.eqRange[1]      // fist closed → full +18 dB bass boost
        : 0;
    }

    if (hands.Right) {
      const wrist = hands.Right[HAND_LANDMARKS.WRIST];
      const yN = this._normY(wrist.y);
      const xN = this._normX(wrist.x);
      const yUp = 1 - yN;
      target.reverb = lerp(yUp, this.opts.reverbRange[0], this.opts.reverbRange[1]);
      target.width = lerp(xN, this.opts.widthRange[0], this.opts.widthRange[1]);
      const newR = this._debounceFist(this.fistHistoryR, gestures.rightFistClosed);
      if (newR !== undefined) this.fistStateR = newR;
      target.hpss = this.fistStateR ? this.opts.hpssClosed : this.opts.hpssOpen;
    }

    if (hands.Left && hands.Right) {
      const avgY = (hands.Left[HAND_LANDMARKS.WRIST].y +
                    hands.Right[HAND_LANDMARKS.WRIST].y) / 2;
      const yN = this._normY(avgY);
      target.master = lerp(1 - yN, this.opts.masterRange[0], this.opts.masterRange[1]);

      const spread = Math.hypot(
        hands.Left[HAND_LANDMARKS.WRIST].x - hands.Right[HAND_LANDMARKS.WRIST].x,
        hands.Left[HAND_LANDMARKS.WRIST].y - hands.Right[HAND_LANDMARKS.WRIST].y
      );
      const sN = clamp((spread - this.bounds.spreadMin) /
                       (this.bounds.spreadMax - this.bounds.spreadMin), 0, 1);
      target.comp = lerp(1 - sN, this.opts.compRange[0], this.opts.compRange[1]);
    }

    // If no hands seen for >0.5s, relax everything to neutral defaults
    if (!hasAny && now - this.lastHandSeen > 500) {
      target.eqHigh = 0; target.eqMid = 0; target.eqLow = 0;
      target.reverb = 0; target.width = 1.0; target.hpss = 0.5;
      target.comp = 0; target.master = 0.85;
    }

    // EMA-smooth and dispatch
    Object.keys(target).forEach(k => {
      this.smoothed[k] = this.smoothed[k] * (1 - EMA_ALPHA) + target[k] * EMA_ALPHA;
    });
    this._dispatch();
  }

  _dispatch() {
    const s = this.smoothed;
    this.engine.setEqHigh(s.eqHigh);
    this.engine.setEqMid(s.eqMid);
    this.engine.setEqLow(s.eqLow);
    this.engine.setReverbWet(s.reverb);
    this.engine.setStereoWidth(s.width);
    this.engine.setHpssMix(s.hpss);
    this.engine.setCompressor(s.comp);
    this.engine.setMasterGain(s.master);
  }

  /**
   * Returns the current parameter snapshot — useful for HUD readouts.
   */
  getCurrentParams() { return { ...this.smoothed }; }

  /**
   * Set explicit calibration bounds (e.g. after a calibration sequence).
   */
  setCalibration({ yMin, yMax, xMin, xMax }) {
    if (yMin !== undefined) this.bounds.yMin = yMin;
    if (yMax !== undefined) this.bounds.yMax = yMax;
    if (xMin !== undefined) this.bounds.xMin = xMin;
    if (xMax !== undefined) this.bounds.xMax = xMax;
  }

  // ─────── internals ───────

  _adaptBounds(hands) {
    const all = [];
    if (hands.Left) all.push(hands.Left[HAND_LANDMARKS.WRIST]);
    if (hands.Right) all.push(hands.Right[HAND_LANDMARKS.WRIST]);
    for (const w of all) {
      // expand bounds immediately when user reaches past
      if (w.y < this.bounds.yMin) this.bounds.yMin = w.y;
      if (w.y > this.bounds.yMax) this.bounds.yMax = w.y;
      if (w.x < this.bounds.xMin) this.bounds.xMin = w.x;
      if (w.x > this.bounds.xMax) this.bounds.xMax = w.x;
    }
    // slowly decay bounds back toward a "reasonable middle" so we don't
    // permanently over-stretch from a one-off gesture
    const decay = 0.0008;
    this.bounds.yMin = Math.min(this.bounds.yMin + decay, 0.30);
    this.bounds.yMax = Math.max(this.bounds.yMax - decay, 0.80);
    this.bounds.xMin = Math.min(this.bounds.xMin + decay, 0.20);
    this.bounds.xMax = Math.max(this.bounds.xMax - decay, 0.80);
  }

  _normY(y) {
    return clamp((y - this.bounds.yMin) /
                 (this.bounds.yMax - this.bounds.yMin || 0.5), 0, 1);
  }
  _normX(x) {
    return clamp((x - this.bounds.xMin) /
                 (this.bounds.xMax - this.bounds.xMin || 0.5), 0, 1);
  }

  _debounceFist(history, raw) {
    history.push(!!raw);
    if (history.length > FIST_HYSTERESIS_FRAMES) history.shift();
    if (history.length < FIST_HYSTERESIS_FRAMES) return false;
    return history.every(v => v) ? true
      : history.every(v => !v) ? false
      : undefined;  // ambiguous; will keep previous state via fallthrough
  }
}

function lerp(t, a, b) { return a + (b - a) * clamp(t, 0, 1); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

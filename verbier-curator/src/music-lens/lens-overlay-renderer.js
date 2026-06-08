/**
 * lens-overlay-renderer.js — Canvas overlay drawing hand skeletons and a HUD.
 *
 * The overlay sits transparently on top of the video element. It renders:
 *   - hand skeleton (21 landmarks, mirrored to match webcam preview)
 *   - per-hand label ("LEFT — high EQ + mid EQ + bass")
 *   - 8 parameter readouts in a corner
 *   - VU meter
 */

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // index
  [5, 9], [9, 10], [10, 11], [11, 12],     // middle
  [9, 13], [13, 14], [14, 15], [15, 16],   // ring
  [13, 17], [17, 18], [18, 19], [19, 20],  // pinky
  [0, 17],                                 // palm base
];

export class LensOverlayRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Render one frame.
   * @param {Object} state - { hands, gestures, params, vuLevel, fps }
   */
  render({ hands, gestures, params, vuLevel = 0, fps = 0 }) {
    const ctx = this.ctx;
    const W = this.canvas.width / (window.devicePixelRatio || 1);
    const H = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, W, H);

    // Hand skeletons (note: webcam is mirrored via CSS, so we draw
    // landmarks at (1-x) to match what the user sees on screen)
    const drawHand = (lm, color, label, fistClosed) => {
      if (!lm) return;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      // connections
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo((1 - lm[a].x) * W, lm[a].y * H);
        ctx.lineTo((1 - lm[b].x) * W, lm[b].y * H);
      }
      ctx.stroke();
      // landmarks
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc((1 - p.x) * W, p.y * H, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // wrist label
      const wx = (1 - lm[0].x) * W;
      const wy = lm[0].y * H;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(wx - 32, wy - 36, 64, 22);
      ctx.fillStyle = color;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label + (fistClosed ? ' ✊' : ''), wx, wy - 21);
    };

    drawHand(hands?.Left, '#7eb6ff', 'LEFT', this._fistL);
    drawHand(hands?.Right, '#ff8c5a', 'RIGHT', this._fistR);

    // Sticky fist state from gestures
    if (gestures?.leftFistClosed !== null && gestures?.leftFistClosed !== undefined)
      this._fistL = gestures.leftFistClosed;
    if (gestures?.rightFistClosed !== null && gestures?.rightFistClosed !== undefined)
      this._fistR = gestures.rightFistClosed;

    // Parameter HUD (top-right)
    if (params) this._drawParamHUD(params, W, H);

    // VU meter (bottom)
    this._drawVU(vuLevel, W, H);

    // FPS pill (bottom-right)
    this._drawFps(fps, W, H);
  }

  _drawParamHUD(p, W, H) {
    const ctx = this.ctx;
    const items = [
      ['EQ Low',     `${p.eqLow.toFixed(1)} dB`,  this._barColor(p.eqLow / 12)],
      ['EQ Mid',     `${p.eqMid.toFixed(1)} dB`,  this._barColor(p.eqMid / 12)],
      ['EQ High',    `${p.eqHigh.toFixed(1)} dB`, this._barColor(p.eqHigh / 12)],
      ['Reverb',     `${(p.reverb * 100).toFixed(0)}%`, '#88d'],
      ['Width',      `${p.width.toFixed(2)}`,     '#88d'],
      ['HPSS',       `${p.hpss.toFixed(2)}`,      '#d8a'],
      ['Compress',   `${(p.comp * 100).toFixed(0)}%`, '#dca'],
      ['Master',     `${(p.master * 100).toFixed(0)}%`, '#9d9'],
    ];

    const w = 220, h = items.length * 22 + 12;
    const x = W - w - 16, y = 16;
    ctx.fillStyle = 'rgba(8, 8, 16, 0.8)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.strokeRect(x, y, w, h);

    ctx.font = '500 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    items.forEach(([label, value, col], i) => {
      const yy = y + 10 + i * 22 + 8;
      ctx.fillStyle = '#aaa';
      ctx.fillText(label, x + 10, yy);
      ctx.fillStyle = col;
      ctx.textAlign = 'right';
      ctx.fillText(value, x + w - 10, yy);
      ctx.textAlign = 'left';
    });
  }

  _barColor(t) {
    // t in [-1, 1] (clamped); negative=blue boost, positive=red cut
    const c = Math.max(-1, Math.min(1, t));
    if (c >= 0) {
      const r = 200 + Math.round(c * 55);
      const g = 200 - Math.round(c * 100);
      const b = 200 - Math.round(c * 100);
      return `rgb(${r},${g},${b})`;
    } else {
      const r = 200 + Math.round(c * 100);
      const g = 200;
      const b = 200 - Math.round(c * 55);
      return `rgb(${r},${g},${b})`;
    }
  }

  _drawVU(level, W, H) {
    const ctx = this.ctx;
    const w = W - 320, x = 16, y = H - 24;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y, w, 8);
    const filled = Math.min(1, level * 2.5) * w;
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#4a4');
    grad.addColorStop(0.7, '#fa4');
    grad.addColorStop(1, '#f44');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, filled, 8);
  }

  _drawFps(fps, W, H) {
    const ctx = this.ctx;
    const text = `${fps.toFixed(0)} fps`;
    ctx.font = '500 11px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(text, W - 16, H - 14);
  }
}

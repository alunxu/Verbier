/**
 * hand-camera.js — Minimal MediaPipe wrapper for the Become the Conductor app.
 *
 * Differences from stem-mixing-prototype/hand-tracker.js:
 *   - Decoupled from audio. Just emits (hands, gestures) via a callback.
 *   - No instrument-to-hand assignment, no stem control.
 *   - Plays nice with multiple consumers (gesture mapper + overlay renderer).
 */

import { GESTURE } from '../shared/constants.js';
import { classifyGestures } from '../legacy/stem-mixing-prototype/gesture-mapping.js';

export class LensHandTracker {
  constructor() {
    this.handLandmarker = null;
    this.imageSegmenter = null;
    this.webcamStream = null;
    this.videoEl = null;
    this.isRunning = false;
    this.lastTimestamp = -1;
    this.lastSegTimestamp = -1;
    this.smoothed = { Left: null, Right: null };
    this.onFrame = null;
    this.onSegment = null;
    this.lastFrameStats = { fps: 0, lastTime: 0, frames: 0 };
    this.cancelled = false;
  }

  /**
   * Initialize webcam + MediaPipe HandLandmarker.
   * @param {HTMLVideoElement} videoEl - hidden video element receiving the cam stream
   * @returns {Promise<{success:boolean, reason?:string}>}
   */
  async init(videoEl) {
    this.videoEl = videoEl;
    this.cancelled = false;
    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 720, height: 480, facingMode: 'user' }
      });
      videoEl.srcObject = this.webcamStream;
    } catch (e) {
      console.warn('Webcam unavailable:', e);
      return { success: false, reason: 'webcam_denied' };
    }

    try {
      const vision = await import('@mediapipe/tasks-vision');
      const { HandLandmarker, ImageSegmenter, FilesetResolver } = vision;
      const fileset = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      // ── Hand landmarks ──
      const handBase = {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      };
      const handOpts = {
        baseOptions: { ...handBase, delegate: 'GPU' },
        numHands: 2,
        runningMode: 'VIDEO',
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      };
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(fileset, handOpts);
      } catch (gpuErr) {
        console.warn('Hand GPU delegate failed, falling back to CPU:', gpuErr);
        handOpts.baseOptions.delegate = 'CPU';
        this.handLandmarker = await HandLandmarker.createFromOptions(fileset, handOpts);
      }

      // ── Selfie segmentation (for ghost overlay) ── best-effort, optional
      // Use confidence masks instead of category masks: they give a soft
      // 0..1 person-probability per pixel, so the boundary feathers naturally
      // instead of producing a hard, jagged edge.
      try {
        this.imageSegmenter = await ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
            delegate: 'GPU',
          },
          outputCategoryMask: false,
          outputConfidenceMasks: true,
          runningMode: 'VIDEO',
        });
      } catch (segErr) {
        console.warn('Selfie segmenter init failed (ghost overlay disabled):', segErr);
        this.imageSegmenter = null;
      }
    } catch (e) {
      console.warn('MediaPipe failed to initialize:', e);
      return { success: false, reason: 'mediapipe_failed' };
    }

    await new Promise(r => {
      if (videoEl.readyState >= 2) r();
      else videoEl.addEventListener('loadeddata', () => r(), { once: true });
      setTimeout(() => r(), 3000);
    });
    if (this.cancelled) return { success: false, reason: 'cancelled' };
    await videoEl.play();
    return { success: true };
  }

  /**
   * Start the detection loop. cb signature: ({hands, gestures, fps}).
   * Calling start() multiple times is safe — only the first one creates
   * the RAF loop; subsequent calls just swap the callback.
   */
  start(cb) {
    this.onFrame = cb;
    if (this.isRunning) return;     // already looping; callback updated
    this.isRunning = true;
    this.lastTimestamp = -1;
    this._loop();
  }

  stop() {
    this.isRunning = false;
    this.cancelled = true;
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(t => t.stop());
      this.webcamStream = null;
    }
    if (this.handLandmarker) {
      try { this.handLandmarker.close(); } catch {}
      this.handLandmarker = null;
    }
    if (this.imageSegmenter) {
      try { this.imageSegmenter.close(); } catch {}
      this.imageSegmenter = null;
    }
  }

  _loop() {
    if (!this.isRunning || !this.handLandmarker) return;
    requestAnimationFrame(() => this._loop());

    if (this.videoEl.readyState < 2) return;

    let ts = performance.now();
    if (ts <= this.lastTimestamp) ts = this.lastTimestamp + 1;
    this.lastTimestamp = ts;

    let result;
    try {
      result = this.handLandmarker.detectForVideo(this.videoEl, ts);
    } catch (e) {
      // Single-frame errors shouldn't kill the loop
      console.warn('Detection frame error:', e.message);
      return;
    }

    const hands = { Left: null, Right: null };
    if (result.landmarks && result.landmarks.length) {
      // Use MediaPipe's handedness for stable hand identity. The browser's
      // selfie-mirrored input lines up with MediaPipe's "input is mirrored"
      // assumption, so its labels match the subject's anatomical L/R.
      // Tutorial detectors are written to be label-agnostic (check either
      // hand) so even if a hand's label briefly flickers it doesn't lock
      // a step.
      result.landmarks.forEach((lm, i) => {
        const hd = result.handednesses?.[i]?.[0]?.categoryName
                   || (i === 0 ? 'Right' : 'Left');
        if (hd === 'Left' || hd === 'Right') {
          hands[hd] = this._smooth(lm, hd);
        }
      });
    }

    const gestures = classifyGestures(hands);

    // FPS estimation
    const now = performance.now();
    this.lastFrameStats.frames++;
    if (now - this.lastFrameStats.lastTime > 1000) {
      this.lastFrameStats.fps = this.lastFrameStats.frames * 1000 /
        (now - this.lastFrameStats.lastTime);
      this.lastFrameStats.frames = 0;
      this.lastFrameStats.lastTime = now;
    }

    if (this.onFrame) {
      this.onFrame({ hands, gestures, fps: this.lastFrameStats.fps });
    }

    // Run selfie segmentation at half-rate (~15fps) to keep CPU/GPU load low
    if (this.imageSegmenter && this.onSegment) {
      const segTs = ts + 1;  // monotonically distinct from hand timestamp
      if (segTs - this.lastSegTimestamp > 60) {
        this.lastSegTimestamp = segTs;
        try {
          this.imageSegmenter.segmentForVideo(this.videoEl, segTs, (result) => {
            if (this.onSegment) {
              const conf = result.confidenceMasks && result.confidenceMasks[0];
              if (conf) this.onSegment(conf, this.videoEl);
            }
          });
        } catch (e) {
          /* drop */
        }
      }
    }
  }

  _smooth(rawLandmarks, key) {
    const alpha = GESTURE.emaAlpha;
    if (!this.smoothed[key]) {
      this.smoothed[key] = rawLandmarks.map(lm => ({ ...lm }));
      return this.smoothed[key];
    }
    const out = this.smoothed[key];
    rawLandmarks.forEach((lm, i) => {
      out[i].x = out[i].x * (1 - alpha) + lm.x * alpha;
      out[i].y = out[i].y * (1 - alpha) + lm.y * alpha;
      out[i].z = out[i].z * (1 - alpha) + lm.z * alpha;
    });
    return out;
  }
}

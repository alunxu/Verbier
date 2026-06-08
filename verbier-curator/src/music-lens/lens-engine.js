/**
 * lens-engine.js — Music Lens runtime audio engine.
 *
 * Plays a pre-computed (mix, harmonic, percussive) trio in sync and runs it
 * through a real-time effect chain controllable by gestures or UI.
 *
 *   sources ─┐
 *            ├─→ source mixer ─→ EQ low ─→ EQ mid ─→ EQ high
 *   mix ─────┤                                            │
 *   harm ────┤                                            ▼
 *   perc ────┘                                       compressor
 *                                                          │
 *                                                          ▼
 *                                                    stereo width
 *                                                          │
 *                                ┌─────dry─────────┐       ▼
 *                                │                 ▼   reverb send
 *                                └──→  ┌─convolver─┴─→  wet gain ─┐
 *                                      │                          │
 *                                       ────────────────merger────┴─→ master ─→ destination
 *
 * No source separation at runtime — all separation work is offline (HPSS).
 * Effect parameters use AudioParam.setTargetAtTime for click-free smoothing.
 */

const SMOOTHING = 0.02;  // seconds — short ramp avoids clicks but stays responsive

export class MusicLensEngine {
  constructor() {
    this.ctx = null;
    this.buffers = null;        // { mix, harmonic, percussive }
    this.sources = null;        // active BufferSourceNodes
    this.startCtxTime = 0;       // ctx.currentTime when playback started
    this.startBufferTime = 0;    // offset within the buffer at start
    this.isPlaying = false;
    this.duration = 0;
    this._onEnded = null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Initialization
  // ────────────────────────────────────────────────────────────────────

  async init() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });

    // Load the Dattorro reverb AudioWorkletProcessor (public-domain, 210 LOC).
    // Source: https://github.com/khoin/DattorroReverbNode
    // This replaces the synthesized-IR ConvolverNode used previously and
    // gives studio-quality plate reverb with k-rate parameters for live
    // tuning during gestures.
    try {
      await this.ctx.audioWorklet.addModule('/dattorroReverb.js');
      this._reverbWorkletAvailable = true;
    } catch (e) {
      console.warn('Dattorro worklet failed to load, falling back to ConvolverNode:', e);
      this._reverbWorkletAvailable = false;
    }

    // === Per-source gains (HPSS mix) ===
    this.gainMix = this.ctx.createGain();        this.gainMix.gain.value = 1.0;
    this.gainHarmonic = this.ctx.createGain();   this.gainHarmonic.gain.value = 0.0;
    this.gainPercussive = this.ctx.createGain(); this.gainPercussive.gain.value = 0.0;

    // === Source-mixer summer ===
    this.sourceSum = this.ctx.createGain();
    this.sourceSum.gain.value = 1.0;
    this.gainMix.connect(this.sourceSum);
    this.gainHarmonic.connect(this.sourceSum);
    this.gainPercussive.connect(this.sourceSum);

    // === 3-band EQ ===
    this.eqLow = this.ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 350;       // pulled higher so laptop speakers can reproduce the boost (60-200 Hz alone is often inaudible without a sub)
    this.eqLow.gain.value = 0;

    this.eqMid = this.ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.5;            // wider Q — covers ~500 Hz–2 kHz
    this.eqMid.gain.value = 0;

    this.eqHigh = this.ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 4000;
    this.eqHigh.gain.value = 0;

    // === Compressor ===
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 1;          // 1 = no compression initially
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.150;

    // === Stereo Width via M/S processing ===
    // Implemented as 4 cross-coefficient gains between a splitter and merger.
    this.widthSplitter = this.ctx.createChannelSplitter(2);
    this.widthMerger = this.ctx.createChannelMerger(2);
    this.gLL = this.ctx.createGain();
    this.gLR = this.ctx.createGain();
    this.gRL = this.ctx.createGain();
    this.gRR = this.ctx.createGain();
    this._setWidthGains(1.0);

    this.widthSplitter.connect(this.gLL, 0);
    this.widthSplitter.connect(this.gLR, 0);
    this.widthSplitter.connect(this.gRL, 1);
    this.widthSplitter.connect(this.gRR, 1);
    this.gLL.connect(this.widthMerger, 0, 0);
    this.gRL.connect(this.widthMerger, 0, 0);
    this.gLR.connect(this.widthMerger, 0, 1);
    this.gRR.connect(this.widthMerger, 0, 1);

    // === Reverb ===
    // Prefer the Dattorro plate-reverb AudioWorklet (high quality, k-rate
    // parameter automation). Falls back to a ConvolverNode with synthesized
    // IR if the worklet failed to load (e.g. served from a non-HTTPS origin
    // or older browser without AudioWorklet).
    if (this._reverbWorkletAvailable) {
      this.dattorro = new AudioWorkletNode(this.ctx, 'DattorroReverb', {
        outputChannelCount: [2],
      });
      // Initial state: dry only
      this.dattorro.parameters.get('wet').value = 0.0;
      this.dattorro.parameters.get('dry').value = 1.0;
      this.dattorro.parameters.get('decay').value = 0.65;       // medium hall
      this.dattorro.parameters.get('preDelay').value = 1200;     // ~25 ms @ 48k
      this.dattorro.parameters.get('damping').value = 0.05;      // gentle HF damping
    } else {
      this.convolver = this.ctx.createConvolver();
      this.convolver.normalize = true;
      this.convolver.buffer = this._makeImpulseResponse(4.0, 1.5);
      this.gainDry = this.ctx.createGain(); this.gainDry.gain.value = 1.0;
      this.gainWet = this.ctx.createGain(); this.gainWet.gain.value = 0.0;
      this.reverbSum = this.ctx.createGain();
    }

    // === Master ===
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;

    // === Wire up: source-mix → EQ → compressor → width → reverb → master ===
    this.sourceSum
      .connect(this.eqLow)
      .connect(this.eqMid)
      .connect(this.eqHigh)
      .connect(this.compressor)
      .connect(this.widthSplitter);

    if (this._reverbWorkletAvailable) {
      // Worklet handles its own dry+wet mix internally
      this.widthMerger.connect(this.dattorro).connect(this.master);
    } else {
      // Fallback: classic dry/wet crossfade with ConvolverNode
      this.widthMerger.connect(this.gainDry).connect(this.reverbSum);
      this.widthMerger.connect(this.convolver).connect(this.gainWet).connect(this.reverbSum);
      this.reverbSum.connect(this.master);
    }
    this.master.connect(this.ctx.destination);

    // Analyser taps for the real-time waveform visualizer:
    //   analyserPre  — after the source mix (HPSS), before any effect chain
    //   analyserPost — after the master gain (everything applied)
    // Both feed the canvas to show "what we have" vs "what we made of it".
    this.analyserPre = this.ctx.createAnalyser();
    this.analyserPre.fftSize = 2048;
    this.analyserPre.smoothingTimeConstant = 0.78;   // smooth FFT visuals
    this.analyserPre.minDecibels = -90;
    this.analyserPre.maxDecibels = -10;
    this.sourceSum.connect(this.analyserPre);

    this.analyserPost = this.ctx.createAnalyser();
    this.analyserPost.fftSize = 2048;
    this.analyserPost.smoothingTimeConstant = 0.78;
    this.analyserPost.minDecibels = -90;
    this.analyserPost.maxDecibels = -10;
    this.master.connect(this.analyserPost);

    // Backwards-compat alias for VU meter
    this.analyser = this.analyserPost;
  }

  /** Get latest waveform samples from pre-effect tap (Float32Array, [-1, 1]). */
  getPreWaveform(buf) {
    if (!this.analyserPre) return null;
    const out = buf || new Float32Array(this.analyserPre.fftSize);
    this.analyserPre.getFloatTimeDomainData(out);
    return out;
  }
  /** Get latest waveform samples from post-master tap. */
  getPostWaveform(buf) {
    if (!this.analyserPost) return null;
    const out = buf || new Float32Array(this.analyserPost.fftSize);
    this.analyserPost.getFloatTimeDomainData(out);
    return out;
  }
  /** Get latest FFT magnitude (dB scale) from pre-effect tap. */
  getPreSpectrum(buf) {
    if (!this.analyserPre) return null;
    const out = buf || new Float32Array(this.analyserPre.frequencyBinCount);
    this.analyserPre.getFloatFrequencyData(out);
    return out;
  }
  /** Get latest FFT magnitude (dB scale) from post-master tap. */
  getPostSpectrum(buf) {
    if (!this.analyserPost) return null;
    const out = buf || new Float32Array(this.analyserPost.frequencyBinCount);
    this.analyserPost.getFloatFrequencyData(out);
    return out;
  }

  // ────────────────────────────────────────────────────────────────────
  // Asset loading
  // ────────────────────────────────────────────────────────────────────

  async loadPiece(manifest, baseUrl) {
    if (!this.ctx) await this.init();
    const fetchBuffer = async (filename) => {
      const url = `${baseUrl}/${filename}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      return this.ctx.decodeAudioData(await res.arrayBuffer());
    };
    const [mix, harmonic, percussive] = await Promise.all([
      fetchBuffer(manifest.files.mix),
      fetchBuffer(manifest.files.harmonic),
      fetchBuffer(manifest.files.percussive),
    ]);
    this.buffers = { mix, harmonic, percussive };
    this.duration = mix.duration;
    return { duration: this.duration, sampleRate: mix.sampleRate };
  }

  // ────────────────────────────────────────────────────────────────────
  // Playback control
  // ────────────────────────────────────────────────────────────────────

  play(offsetSec = 0) {
    if (!this.buffers) throw new Error('Call loadPiece() first');
    if (this.isPlaying) this.stop();
    if (this.ctx.state === 'suspended') this.ctx.resume();

    const t0 = this.ctx.currentTime + 0.05;  // small leadtime for sync
    this.startCtxTime = t0;
    this.startBufferTime = offsetSec;

    const startSource = (buffer, gainNode) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(gainNode);
      src.start(t0, offsetSec);
      return src;
    };

    this.sources = {
      mix: startSource(this.buffers.mix, this.gainMix),
      harmonic: startSource(this.buffers.harmonic, this.gainHarmonic),
      percussive: startSource(this.buffers.percussive, this.gainPercussive),
    };
    this.sources.mix.onended = () => {
      if (this._onEnded && this.isPlaying) this._onEnded();
    };
    this.isPlaying = true;
  }

  stop() {
    if (!this.sources) return;
    Object.values(this.sources).forEach(s => { try { s.stop(); } catch {} });
    this.sources = null;
    this.isPlaying = false;
  }

  pause() { this.stop(); }

  seek(sec) {
    const wasPlaying = this.isPlaying;
    this.stop();
    if (wasPlaying) this.play(Math.max(0, Math.min(this.duration, sec)));
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.startBufferTime;
    return this.startBufferTime + (this.ctx.currentTime - this.startCtxTime);
  }

  onEnded(cb) { this._onEnded = cb; }

  // ────────────────────────────────────────────────────────────────────
  // Real-time parameter setters
  // ────────────────────────────────────────────────────────────────────

  // EQ (dB, typical range ±12)
  setEqLow(db)  { this._ramp(this.eqLow.gain, db); }
  setEqMid(db)  { this._ramp(this.eqMid.gain, db); }
  setEqHigh(db) { this._ramp(this.eqHigh.gain, db); }

  // HPSS mix: ratio in [0, 1].
  //   ratio = 0.5 → original mix only (cleanest)
  //   ratio → 1   → fade from mix to harmonic-only (de-emphasize attacks)
  //   ratio → 0   → fade from mix to percussive-only (rhythm focus)
  setHpssMix(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    let gMix, gH, gP;
    if (r > 0.5) {
      const t = (r - 0.5) * 2;
      gMix = 1 - t; gH = t; gP = 0;
    } else {
      const t = (0.5 - r) * 2;
      gMix = 1 - t; gH = 0; gP = t;
    }
    this._ramp(this.gainMix.gain, gMix);
    this._ramp(this.gainHarmonic.gain, gH);
    this._ramp(this.gainPercussive.gain, gP);
  }

  // Stereo width: 0 = mono, 1 = original, 3 = very wide
  setStereoWidth(w) {
    const wc = Math.max(0, Math.min(3.5, w));
    this._setWidthGains(wc);
  }

  _setWidthGains(w) {
    const same = 0.5 + 0.5 * w;
    const cross = 0.5 - 0.5 * w;
    this._ramp(this.gLL.gain, same);
    this._ramp(this.gRR.gain, same);
    this._ramp(this.gLR.gain, cross);
    this._ramp(this.gRL.gain, cross);
  }

  // Reverb wet [0, 1]
  setReverbWet(wet) {
    const w = Math.max(0, Math.min(1, wet));
    if (this._reverbWorkletAvailable) {
      // Tie three Dattorro params to the single "wet" gesture/slider:
      //   wet     0..0.55   (peak below 1.0 to leave dynamic headroom)
      //   dry     1.0..0.4  (always retain some attack from the dry signal)
      //   decay   0.4..0.85 (longer reverb time at higher wet → bigger room)
      this._ramp(this.dattorro.parameters.get('wet'), w * 0.55);
      this._ramp(this.dattorro.parameters.get('dry'), 1.0 - w * 0.6);
      this._ramp(this.dattorro.parameters.get('decay'), 0.4 + w * 0.45);
    } else {
      // ConvolverNode fallback
      this._ramp(this.gainDry.gain, Math.cos(w * Math.PI / 2));
      this._ramp(this.gainWet.gain, Math.sin(w * Math.PI / 2) * 1.8);
    }
  }

  // Compressor amount [0, 1] — smoothly ramps threshold + ratio together
  setCompressor(amount) {
    const a = Math.max(0, Math.min(1, amount));
    this._ramp(this.compressor.threshold, -24 - a * 24);  // -24 → -48 dB
    this._ramp(this.compressor.ratio, 1 + a * 11);        // 1 → 12
  }

  // Master gain (linear, 0–1.5)
  setMasterGain(g) { this._ramp(this.master.gain, Math.max(0, Math.min(1.5, g))); }

  // Smooth ramp helper — short time constant, click-free
  _ramp(audioParam, target) {
    audioParam.setTargetAtTime(target, this.ctx.currentTime, SMOOTHING);
  }

  // ────────────────────────────────────────────────────────────────────
  // Presets
  // ────────────────────────────────────────────────────────────────────

  applyPreset(name) {
    const presets = {
      Original:    { eqLow: 0,  eqMid: 0,  eqHigh: 0,  width: 1.0, reverb: 0.00, hpss: 0.5, comp: 0.00, master: 0.85 },
      ConcertHall: { eqLow: 1,  eqMid: 0,  eqHigh: 1,  width: 1.3, reverb: 0.55, hpss: 0.5, comp: 0.15, master: 0.85 },
      Cinematic:   { eqLow: 5,  eqMid: -1, eqHigh: 2,  width: 1.5, reverb: 0.70, hpss: 0.5, comp: 0.40, master: 0.85 },
      Intimate:    { eqLow: -2, eqMid: 3,  eqHigh: 0,  width: 0.5, reverb: 0.15, hpss: 0.5, comp: 0.00, master: 0.85 },
    };
    const p = presets[name];
    if (!p) throw new Error(`Unknown preset: ${name}`);
    this.setEqLow(p.eqLow);
    this.setEqMid(p.eqMid);
    this.setEqHigh(p.eqHigh);
    this.setStereoWidth(p.width);
    this.setReverbWet(p.reverb);
    this.setHpssMix(p.hpss);
    this.setCompressor(p.comp);
    this.setMasterGain(p.master);
    return p;  // so the UI can sync sliders without reading AudioParams mid-glide
  }

  // ────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────

  // Synthesize a stereo decaying-noise impulse response for ConvolverNode.
  // Improvements over plain noise:
  //   - 25 ms pre-delay → brain perceives a real "room distance"
  //   - independent L/R randomness → stereo decorrelation, spaciousness
  //   - one-pole low-pass smoothing → warmer, less metallic high tail
  _makeImpulseResponse(durationSec = 4.0, decay = 1.5) {
    const sr = this.ctx.sampleRate;
    const length = Math.floor(sr * durationSec);
    const ir = this.ctx.createBuffer(2, length, sr);
    const preDelay = Math.floor(sr * 0.025);

    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      // Pre-delay: silence so the dry attack stays distinct
      for (let i = 0; i < preDelay; i++) data[i] = 0;
      // Decaying noise tail (channels are independently random for width)
      for (let i = preDelay; i < length; i++) {
        const t = (i - preDelay) / (length - preDelay);
        const env = Math.pow(1 - t, decay);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      // One-pole low-pass to soften the brittle high frequencies
      let prev = 0;
      for (let i = 0; i < length; i++) {
        prev = data[i] = data[i] * 0.7 + prev * 0.3;
      }
    }
    return ir;
  }

  // Get RMS in [0, 1] for VU meter
  getMasterRms() {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  dispose() {
    this.stop();
    if (this.ctx) this.ctx.close();
  }
}

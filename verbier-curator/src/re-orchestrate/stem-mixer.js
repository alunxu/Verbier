/**
 * stem-mixer.js — Web Audio API multi-stem player and mixer
 *
 * Loads separated instrument tracks and plays them in sync.
 * Exposes per-stem gain, panning, and reverb controls.
 */

import { GESTURE } from '../shared/constants.js';

let audioContext;
let stemSources = {};
let stemGains = {};
let stemPanners = {};
let masterGain;
let compressor;
let isPlaying = false;
let startTime = 0;
let performance = null;
let timeUpdateCallback = null;
let animFrameId = null;
let totalDuration = 0;

/**
 * Initialize the Re-Orchestrate audio engine.
 */
export async function initReOrchestrate({ performance: perf, audioContext: ctx, onTimeUpdate }) {
    audioContext = ctx;
    performance = perf;
    timeUpdateCallback = onTimeUpdate;

    // Master chain: compressor → destination
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -6;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    compressor.connect(audioContext.destination);

    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(compressor);

    // Load all stems
    const stems = perf.stems || {};
    const instruments = perf.instrumentation || [];

    console.log(`Loading ${instruments.length} stems...`);

    const loadPromises = instruments.map(async (inst) => {
        const url = stems[inst];
        if (!url) {
            console.warn(`No stem URL for ${inst}`);
            return;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.warn(`Failed to load stem ${inst}: HTTP ${response.status}`);
                return;
            }
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Track the longest stem for duration
            if (audioBuffer.duration > totalDuration) {
                totalDuration = audioBuffer.duration;
            }

            // Create per-stem signal chain:
            // BufferSource → GainNode → StereoPannerNode → masterGain
            const gainNode = audioContext.createGain();
            gainNode.gain.value = 0.8;

            const pannerNode = audioContext.createStereoPanner();
            pannerNode.pan.value = 0;

            gainNode.connect(pannerNode);
            pannerNode.connect(masterGain);

            stemGains[inst] = gainNode;
            stemPanners[inst] = pannerNode;

            // Store buffer for later playback
            stemSources[inst] = {
                buffer: audioBuffer,
                gainNode,
                pannerNode,
                source: null
            };

            console.log(`  Loaded stem: ${inst} (${audioBuffer.duration.toFixed(1)}s)`);
        } catch (e) {
            console.warn(`Error loading stem ${inst}:`, e);
        }
    });

    await Promise.all(loadPromises);

    // Listen for fallback slider events
    window.addEventListener('stem-gain-change', handleSliderChange);

    console.log(`All stems loaded. Total duration: ${totalDuration.toFixed(1)}s`);
}

function handleSliderChange(e) {
    const { instrument, gain } = e.detail;
    setStemGain(instrument, gain);
}

/**
 * Start synchronized playback of all stems.
 */
export function startPlayback() {
    if (isPlaying) return;

    const now = audioContext.currentTime;
    startTime = now;

    Object.entries(stemSources).forEach(([inst, stem]) => {
        if (!stem.buffer) return;

        const source = audioContext.createBufferSource();
        source.buffer = stem.buffer;
        source.connect(stem.gainNode);
        source.start(now);
        stem.source = source;

        // Handle end of playback
        source.onended = () => {
            stem.source = null;
        };
    });

    isPlaying = true;
    updateTimeLoop();
    console.log('Playback started');
}

/**
 * Stop playback.
 */
export function stopPlayback() {
    isPlaying = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);

    Object.values(stemSources).forEach(stem => {
        try { stem.source?.stop(); } catch (e) { /* ok */ }
        stem.source = null;
    });
}

/**
 * Set gain for a specific stem.
 * @param {string} instrument - Instrument name
 * @param {number} gain - Gain value [0, 1]
 */
export function setStemGain(instrument, gain) {
    const node = stemGains[instrument];
    if (node) {
        node.gain.setTargetAtTime(
            Math.max(GESTURE.gainRangeMin, Math.min(GESTURE.gainRangeMax, gain)),
            audioContext.currentTime,
            0.1
        );
    }

    // Update VU meter
    const vuBar = document.getElementById(`vu-${instrument}`);
    if (vuBar) {
        vuBar.style.height = `${gain * 100}%`;
    }
}

/**
 * Set stereo pan for a specific stem.
 * @param {string} instrument - Instrument name
 * @param {number} pan - Pan value [-1, 1]
 */
export function setStemPan(instrument, pan) {
    const node = stemPanners[instrument];
    if (node) {
        // Use immediate ramp for responsive stereo control
        const clampedPan = Math.max(-1, Math.min(1, pan));
        node.pan.linearRampToValueAtTime(clampedPan, audioContext.currentTime + 0.05);
    }
}

/**
 * Set all stem gains (from gesture data).
 * @param {Object} gains - { instrument: gainValue }
 */
export function setAllGains(gains) {
    Object.entries(gains).forEach(([inst, gain]) => {
        setStemGain(inst, gain);
    });
}

/**
 * Mute/unmute a stem with fade.
 * @param {string} instrument
 * @param {boolean} muted
 */
export function setStemMuted(instrument, muted) {
    const node = stemGains[instrument];
    if (node) {
        const fadeTime = GESTURE.muteTransitionMs / 1000;
        const targetGain = muted ? 0 : 0.8; // True mute (0 gain) when fist closed
        node.gain.cancelScheduledValues(audioContext.currentTime);
        node.gain.linearRampToValueAtTime(targetGain, audioContext.currentTime + fadeTime);

        // Update VU meter immediately for visual feedback
        const vuBar = document.getElementById(`vu-${instrument}`);
        if (vuBar) {
            vuBar.style.height = `${targetGain * 100}%`;
        }
    }
}

/**
 * Get current playback time.
 */
export function getCurrentTime() {
    if (!isPlaying) return 0;
    return audioContext.currentTime - startTime;
}

/**
 * Get total duration of the performance.
 */
export function getDuration() {
    return totalDuration;
}

function updateTimeLoop() {
    if (!isPlaying) return;
    animFrameId = requestAnimationFrame(updateTimeLoop);

    if (timeUpdateCallback) {
        timeUpdateCallback(getCurrentTime(), totalDuration);
    }
}

/**
 * Clean up audio resources.
 */
export function disposeReOrchestrate() {
    stopPlayback();
    window.removeEventListener('stem-gain-change', handleSliderChange);

    Object.values(stemGains).forEach(n => { try { n.disconnect(); } catch (e) { } });
    Object.values(stemPanners).forEach(n => { try { n.disconnect(); } catch (e) { } });
    if (masterGain) { try { masterGain.disconnect(); } catch (e) { } }
    if (compressor) { try { compressor.disconnect(); } catch (e) { } }

    stemSources = {};
    stemGains = {};
    stemPanners = {};
    masterGain = null;
    compressor = null;
    totalDuration = 0;
}

/**
 * main.js — Verbier Festival Entry Point
 *
 * Coordinates the two-part installation:
 *   Part 1: Breathing Verbier (landscape navigation)
 *   Part 2: Re-Orchestrate (gesture-controlled mixing)
 */

import './style.css';
import { initLandscape, disposeLandscape, resumeLandscape } from './breathing-verbier/landscape.js';
import { initReOrchestrate, disposeReOrchestrate, startPlayback, stopPlayback } from './re-orchestrate/stem-mixer.js';
import { initHandTracker, stopHandTracker } from './re-orchestrate/hand-tracker.js';
import { initOverlay, clearOverlay } from './re-orchestrate/overlay-renderer.js';
import { initVideoPlayer, disposeVideoPlayer } from './re-orchestrate/video-player.js';
import { playTransitionToReOrchestrate, playTransitionToLandscape } from './shared/transition.js';
import { TRANSITION } from './shared/constants.js';
import { initSplashCanvas, destroySplashCanvas } from './splash-canvas.js';

// Application state
const state = {
    audioContext: null,
    currentMode: 'splash', // 'splash' | 'landscape' | 'reorchestrate'
    selectedPerformance: null,
    performances: [],
    isTransitioning: false
};

// ============================================================
// Initialization
// ============================================================

async function init() {
    // Load performance manifest
    try {
        const resp = await fetch('/assets/manifests/performances.json');
        if (resp.ok) {
            let loadedData = await resp.json();
            
            // Fix: Mismatched file extensions. JSON says .ogg, actual files are .wav.
            // Also explicitly map the raw DCML titles for the demo pieces
            loadedData.forEach(p => {
                if (p.audio_url) p.audio_url = p.audio_url.replace(/\.ogg$/, '.wav');
                
                if (p.title === 'n01op18 1 01') p.title = 'String Quartet No. 1, Op. 18 (Mov. 1)';
                if (p.title === 'op01n01a') p.title = 'Trio Sonata, Op. 1 No. 1';
                if (p.title === '01op12a') p.title = 'String Quartet No. 1, Op. 12';
            });
            
            state.performances = loadedData.slice(0, 3); // Restrict to 3 pieces
            console.log(`Loaded ${state.performances.length} performances`);
        } else {
            console.warn('No performances.json found, using demo data');
            state.performances = generateDemoPerformances();
        }
    } catch (e) {
        console.warn('Failed to load performances.json, using demo data:', e);
        state.performances = generateDemoPerformances();
    }

    // Set up splash screen
    const enterButton = document.getElementById('enter-button');
    const splashScreen = document.getElementById('splash-screen');

    // Start splash canvas animation
    initSplashCanvas();

    enterButton.addEventListener('click', async () => {
        // Create AudioContext on user gesture (required by browsers)
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // Stop splash canvas animation
        destroySplashCanvas();

        // Fade out splash
        splashScreen.classList.add('hidden');

        // Start Part 1
        setTimeout(() => {
            enterLandscapeMode();
        }, 500);
    });

    // Back button
    const backButton = document.getElementById('back-button');
    backButton.addEventListener('click', () => {
        if (state.currentMode === 'reorchestrate' && !state.isTransitioning) {
            exitReOrchestrateMode();
        }
    });
}

// ============================================================
// Mode Management
// ============================================================

function enterLandscapeMode() {
    state.currentMode = 'landscape';
    console.log('Entering Breathing Verbier mode');

    document.getElementById('landscape-ui').classList.remove('hidden');

    initLandscape({
        container: document.getElementById('canvas-container'),
        performances: state.performances,
        audioContext: state.audioContext,
        onPerformanceSelect: handlePerformanceSelect
    });
}

async function handlePerformanceSelect(performance) {
    if (state.isTransitioning) return;
    state.isTransitioning = true;
    state.selectedPerformance = performance;

    console.log(`Selected: ${performance.composer} — ${performance.title}`);

    // Show loading
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const loadingBar = document.getElementById('loading-bar');
    loadingOverlay.classList.remove('hidden');
    loadingText.textContent = `Loading ${performance.title}...`;
    loadingBar.style.width = '10%';

    // Play transition animation
    await playTransitionToReOrchestrate(performance);
    loadingBar.style.width = '40%';

    // Enter Re-Orchestrate mode
    await enterReOrchestrateMode(performance);
    loadingBar.style.width = '100%';

    // Hide loading
    setTimeout(() => {
        loadingOverlay.classList.add('hidden');
        loadingBar.style.width = '0%';
        state.isTransitioning = false;
    }, 300);
}

async function enterReOrchestrateMode(performance) {
    state.currentMode = 'reorchestrate';
    console.log('Entering Re-Orchestrate mode');

    const container = document.getElementById('re-orchestrate-container');
    container.classList.add('active');
    
    // Hide landscape UI
    document.getElementById('landscape-ui').classList.add('hidden');

    // Show performance info
    const perfInfo = document.getElementById('performance-info');
    document.getElementById('info-composer').textContent = performance.composer;
    document.getElementById('info-title').textContent = performance.title;
    perfInfo.classList.add('visible');

    // Show back button
    document.getElementById('back-button').classList.add('visible');

    // Initialize stem mixer
    await initReOrchestrate({
        performance,
        audioContext: state.audioContext,
        onTimeUpdate: handleTimeUpdate
    });

    // Initialize overlay canvas
    initOverlay(document.getElementById('overlay-canvas'));

    // Initialize video/placeholder layer
    initVideoPlayer(performance, document.getElementById('video-layer'));

    // Build VU meters
    buildVuMeters(performance.instrumentation);

    // Try webcam / hand tracking
    let hasWebcam = false;
    try {
        hasWebcam = await Promise.race([
            initHandTracker({
                videoElement: document.getElementById('webcam-video'),
                previewContainer: document.getElementById('webcam-preview'),
                overlayCanvas: document.getElementById('overlay-canvas'),
                performance,
                audioContext: state.audioContext
            }),
            new Promise((resolve) =>
                setTimeout(() => {
                    console.warn('Webcam init timeout — falling back to sliders');
                    // Cancel the hand tracker so it doesn't start late
                    stopHandTracker();
                    resolve(false);
                }, 8000)
            )
        ]);
    } catch (e) {
        console.warn('Hand tracking unavailable:', e.message);
        stopHandTracker();
    }

    if (!hasWebcam) {
        // Fall back to slider controls
        buildFallbackMixer(performance);
    }

    // Show tutorial (only for webcam mode)
    showTutorial(hasWebcam);

    // Start playback — immediately for fallback, after tutorial for webcam
    const playbackDelay = hasWebcam ? (TRANSITION.tutorialDuration * 1000 + 500) : 500;
    setTimeout(() => {
        startPlayback();
    }, playbackDelay);
}

async function exitReOrchestrateMode() {
    if (state.isTransitioning) return;
    state.isTransitioning = true;

    console.log('Returning to Breathing Verbier');

    // Stop playback and hand tracking
    stopPlayback();
    stopHandTracker();
    clearOverlay();

    // Hide UI elements
    document.getElementById('re-orchestrate-container').classList.remove('active');
    document.getElementById('performance-info').classList.remove('visible');
    document.getElementById('back-button').classList.remove('visible');
    document.getElementById('fallback-mixer').style.display = 'none';
    document.getElementById('landscape-ui').classList.remove('hidden');

    // Clean up
    disposeReOrchestrate();
    disposeVideoPlayer();

    // Play reverse transition
    await playTransitionToLandscape();

    // Resume landscape
    resumeLandscape();
    state.currentMode = 'landscape';
    state.selectedPerformance = null;
    state.isTransitioning = false;
}

// ============================================================
// UI Helpers
// ============================================================

function buildVuMeters(instruments) {
    const container = document.getElementById('vu-meters');
    container.innerHTML = '';

    instruments.forEach(inst => {
        const meter = document.createElement('div');
        meter.className = 'vu-meter';
        meter.innerHTML = `
      <div class="vu-meter-bar-container">
        <div class="vu-meter-bar" id="vu-${inst}" style="height: 0%"></div>
      </div>
      <span class="vu-meter-label">${inst}</span>
    `;
        container.appendChild(meter);
    });
}

function buildFallbackMixer(performance) {
    const container = document.getElementById('fallback-mixer');
    container.style.display = 'flex';
    container.innerHTML = '';

    performance.instrumentation.forEach(inst => {
        const slider = document.createElement('div');
        slider.className = 'fallback-slider';
        slider.innerHTML = `
      <input type="range" id="slider-${inst}" min="0" max="100" value="80"
             orient="vertical" aria-label="${inst} volume">
      <label for="slider-${inst}">${inst}</label>
    `;
        container.appendChild(slider);

        // Wire slider to stem gain
        const input = slider.querySelector('input');
        input.addEventListener('input', (e) => {
            const gain = parseInt(e.target.value) / 100;
            // Update stem gain via event
            window.dispatchEvent(new CustomEvent('stem-gain-change', {
                detail: { instrument: inst, gain }
            }));
            // Update VU meter
            const vuBar = document.getElementById(`vu-${inst}`);
            if (vuBar) vuBar.style.height = `${gain * 100}%`;
        });
    });
}

function showTutorial(hasWebcam) {
    const tutorial = document.getElementById('tutorial-overlay');

    if (hasWebcam) {
        tutorial.classList.remove('hidden');
        // Dismiss on click/tap anywhere
        const dismiss = () => {
            tutorial.classList.add('hidden');
            tutorial.removeEventListener('click', dismiss);
        };
        tutorial.addEventListener('click', dismiss);
        tutorial.style.cursor = 'pointer';
    }
    // Skip tutorial if no webcam (fallback sliders are self-explanatory)
}

function handleTimeUpdate(currentTime, duration) {
    const progress = document.getElementById('timeline-progress');
    if (progress && duration > 0) {
        progress.style.width = `${(currentTime / duration) * 100}%`;
    }
}

// ============================================================
// Demo Data Fallback
// ============================================================

function generateDemoPerformances() {
    const composers = [
        { name: 'Ludwig van Beethoven', pieces: ['String Quartet Op. 18 No. 1', 'Serenade for Flute, Violin, and Viola'] },
        { name: 'Wolfgang Amadeus Mozart', pieces: ['String Trio Divertimento K. 563', 'Clarinet Quintet K. 581'] },
        { name: 'Johannes Brahms', pieces: ['Horn Trio Op. 40', 'String Quartet Op. 51 No. 1'] },
        { name: 'Joseph Haydn', pieces: ['String Quartet Op. 76 No. 3', 'Piano Trio No. 39'] },
        { name: 'Franz Schubert', pieces: ['String Quintet D. 956'] },
        { name: 'Antonín Dvořák', pieces: ['String Quartet No. 12 "American"'] }
    ];

    const instrumentSets = [
        ['violin1', 'violin2', 'viola', 'cello'],
        ['flute', 'violin', 'viola'],
        ['clarinet', 'violin1', 'violin2', 'viola', 'cello'],
        ['horn', 'violin', 'piano'],
        ['violin', 'viola', 'cello'],
        ['flute', 'oboe'],
        ['trumpet1', 'trumpet2'],
        ['violin1', 'violin2', 'viola', 'cello', 'cello2']
    ];

    const performances = [];
    let id = 1;

    for (const composer of composers) {
        for (const piece of composer.pieces) {
            const instruments = instrumentSets[(id - 1) % instrumentSets.length];
            const stems = {};
            const fileId = ((id - 1) % 14) + 1; // Clamp to 14 so URMP stems exist
            instruments.forEach(inst => {
                stems[inst] = `assets/stems/urmp_${String(fileId).padStart(2, '0')}_${inst}.wav`;
            });

            performances.push({
                id: `urmp_demo_${id}`,
                title: piece,
                composer: composer.name,
                ensemble: 'URMP Ensemble',
                genre: 'chamber',
                instrumentation: instruments,
                audio_url: `assets/audio/urmp_${String(fileId).padStart(2, '0')}_mix.wav`,
                stems,
                video_url: null,
                features_timeseries_url: `assets/features/urmp_${String(fileId).padStart(2, '0')}_mix_features.json`,
                preview_excerpt: { start_sec: 10, end_sec: 25 },
                // Demo feature summary (will be replaced by real extraction)
                features_summary: {
                    spectral_centroid_mean: 1500 + Math.random() * 2000,
                    rms_mean: 0.02 + Math.random() * 0.06,
                    tempo_bpm: 60 + Math.random() * 120,
                    dominant_chroma: Math.floor(Math.random() * 12),
                    spectral_flux_mean: 0.3 + Math.random() * 0.7,
                    tonnetz_mean: Array.from({ length: 6 }, () => (Math.random() - 0.5) * 0.3),
                    spectral_bandwidth_mean: 1000 + Math.random() * 2000,
                    mfcc_mean: Array.from({ length: 13 }, () => (Math.random() - 0.5) * 20)
                },
                umap_position: {
                    x: 0.1 + Math.random() * 0.8,
                    y: 0.1 + Math.random() * 0.8
                },
                year: Math.floor(Math.random() * (2024 - 2004 + 1)) + 2004
            });
            id++;
        }
    }

    return performances.slice(0, 3);
}

// ============================================================
// Start
// ============================================================

document.addEventListener('DOMContentLoaded', init);

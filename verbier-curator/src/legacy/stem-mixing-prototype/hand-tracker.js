/**
 * hand-tracker.js — MediaPipe Hands integration + gesture classification
 *
 * Captures webcam, runs hand landmark detection, extracts gestures,
 * and maps them to audio parameters.
 */

import { GESTURE, HAND_LANDMARKS, INSTRUMENT_REGISTER } from '../../shared/constants.js';
import { setStemGain, setStemPan, setStemMuted, setAllGains } from './stem-mixer.js';
import { classifyGestures } from './gesture-mapping.js';
import { drawHandOverlay } from './overlay-renderer.js';

let handLandmarker = null;
let webcamStream = null;
let videoElement = null;
let overlayCanvas = null;
let currentPerformance = null;
let isRunning = false;
let animFrameId = null;
let lastDetectionTimestamp = -1;
let initCancelled = false;

// Smoothed landmark history
let smoothedLandmarks = { Left: null, Right: null };

// Instrument group assignment
let leftHandInstruments = [];
let rightHandInstruments = [];

/**
 * Initialize hand tracking.
 * @returns {Promise<boolean>} true if webcam+tracking is available
 */
export async function initHandTracker({ videoElement: vidEl, previewContainer, overlayCanvas: canvas, performance, audioContext }) {
    videoElement = vidEl;
    overlayCanvas = canvas;
    currentPerformance = performance;

    // Assign instruments to hands based on register
    assignInstrumentsToHands(performance.instrumentation);

    // Try to get webcam
    try {
        webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 720, height: 480, facingMode: 'user' }
        });
        videoElement.srcObject = webcamStream;
        previewContainer.style.display = 'block';
    } catch (e) {
        console.warn('Webcam not available:', e);
        return false;
    }

    // Initialize MediaPipe HandLandmarker (try GPU first, fallback to CPU)
    try {
        const vision = await import('@mediapipe/tasks-vision');
        const { HandLandmarker, FilesetResolver } = vision;

        const filesetResolver = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        // Try GPU delegate first, fall back to CPU
        let delegate = 'GPU';
        try {
            handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                    delegate: 'GPU'
                },
                numHands: 2,
                runningMode: 'VIDEO',
                minHandDetectionConfidence: 0.3,
                minHandPresenceConfidence: 0.3,
                minTrackingConfidence: 0.3
            });
        } catch (gpuErr) {
            console.warn('GPU delegate failed, falling back to CPU:', gpuErr);
            delegate = 'CPU';
            handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                    delegate: 'CPU'
                },
                numHands: 2,
                runningMode: 'VIDEO',
                minHandDetectionConfidence: 0.3,
                minHandPresenceConfidence: 0.3,
                minTrackingConfidence: 0.3
            });
        }

        console.log(`MediaPipe HandLandmarker initialized (${delegate})`);
    } catch (e) {
        console.warn('MediaPipe initialization failed:', e);
        return false;
    }

    // Wait for video element to be ready before starting detection
    isRunning = true;
    initCancelled = false;
    await new Promise((resolve, reject) => {
        if (videoElement.readyState >= 2) {
            resolve();
        } else {
            videoElement.addEventListener('loadeddata', resolve, { once: true });
            videoElement.addEventListener('error', reject, { once: true });
            // Safety timeout
            setTimeout(() => resolve(), 3000);
        }
    });

    if (initCancelled) return false;

    await videoElement.play();
    lastDetectionTimestamp = -1;
    trackingLoop();

    return true;
}

function assignInstrumentsToHands(instruments) {
    leftHandInstruments = [];
    rightHandInstruments = [];

    instruments.forEach(inst => {
        const lower = inst.toLowerCase();
        if (INSTRUMENT_REGISTER.low.some(i => lower.includes(i))) {
            leftHandInstruments.push(inst);
        } else if (INSTRUMENT_REGISTER.high.some(i => lower.includes(i))) {
            rightHandInstruments.push(inst);
        } else {
            // Distribute mid-register instruments evenly
            if (leftHandInstruments.length <= rightHandInstruments.length) {
                leftHandInstruments.push(inst);
            } else {
                rightHandInstruments.push(inst);
            }
        }
    });

    // If one hand has no instruments, split evenly
    if (leftHandInstruments.length === 0 || rightHandInstruments.length === 0) {
        const all = [...instruments];
        const mid = Math.ceil(all.length / 2);
        leftHandInstruments = all.slice(0, mid);
        rightHandInstruments = all.slice(mid);
    }

    console.log('Left hand instruments:', leftHandInstruments);
    console.log('Right hand instruments:', rightHandInstruments);
}

function trackingLoop() {
    if (!isRunning || !handLandmarker) return;
    animFrameId = requestAnimationFrame(trackingLoop);

    if (videoElement.readyState < 2) return; // Not ready yet

    try {
        // Ensure monotonically increasing timestamps (MediaPipe requirement)
        let timestamp = performance.now();
        if (timestamp <= lastDetectionTimestamp) {
            timestamp = lastDetectionTimestamp + 1;
        }
        lastDetectionTimestamp = timestamp;

        // Run detection
        const result = handLandmarker.detectForVideo(videoElement, timestamp);

        if (result.landmarks && result.landmarks.length > 0) {
            const hands = {};
            
            // Robust Left/Right assignment
            if (result.landmarks.length === 2) {
                // If 2 hands are detected, sort by X coordinate to guarantee one is Left and one is Right
                // Because webcam stream is mirrored (scaleX(-1)), the user's physical left hand appears on 
                // the right side of the raw image (x ~ 0.8), and the physical right hand on the left (x ~ 0.2).
                const x0 = result.landmarks[0][0].x;
                const x1 = result.landmarks[1][0].x;
                
                if (x0 > x1) {
                    hands['Left'] = smoothLandmarks(result.landmarks[0], 'Left');
                    hands['Right'] = smoothLandmarks(result.landmarks[1], 'Right');
                } else {
                    hands['Right'] = smoothLandmarks(result.landmarks[0], 'Right');
                    hands['Left'] = smoothLandmarks(result.landmarks[1], 'Left');
                }
            } else {
                // Single hand: fallback to MediaPipe's guess, but flipped for the mirror
                result.landmarks.forEach((landmarks, i) => {
                    const handedness = result.handednesses?.[i]?.[0]?.categoryName || (i === 0 ? 'Right' : 'Left');
                    const actualHand = handedness === 'Right' ? 'Left' : 'Right';
                    hands[actualHand] = smoothLandmarks(landmarks, actualHand);
                });
            }

            // Classify gestures
            const gestures = classifyGestures(hands);

            // Apply to audio
            applyGesturesToAudio(gestures, hands);

            // Draw overlay
            drawHandOverlay(overlayCanvas, hands, {
                leftInstruments: leftHandInstruments,
                rightInstruments: rightHandInstruments,
                gestures
            });
        }
    } catch (e) {
        // Don't let a single frame error kill the entire tracking loop
        console.warn('Hand detection frame error:', e.message);
    }
}

function smoothLandmarks(rawLandmarks, handKey) {
    const alpha = GESTURE.emaAlpha;

    if (!smoothedLandmarks[handKey]) {
        smoothedLandmarks[handKey] = rawLandmarks.map(lm => ({ ...lm }));
        return smoothedLandmarks[handKey];
    }

    const smoothed = smoothedLandmarks[handKey];
    rawLandmarks.forEach((lm, i) => {
        smoothed[i].x = smoothed[i].x * (1 - alpha) + lm.x * alpha;
        smoothed[i].y = smoothed[i].y * (1 - alpha) + lm.y * alpha;
        smoothed[i].z = smoothed[i].z * (1 - alpha) + lm.z * alpha;
    });

    return smoothed;
}

// Track mute state to detect changes (edge detection)
let mutedState = {};

function applyGesturesToAudio(gestures, hands) {
    // Adaptive Calibration for Gestures
    // Continuously learn the user's physical reach bounds to make control immediate and dramatic
    if (!GESTURE.dynamicYMin) GESTURE.dynamicYMin = 0.3;
    if (!GESTURE.dynamicYMax) GESTURE.dynamicYMax = 0.7;

    const adaptBounds = (y) => {
        // Slowly decay bounds back towards center to adapt if user lowers their arms
        GESTURE.dynamicYMin = Math.min(GESTURE.dynamicYMin * 1.001, 0.4);
        GESTURE.dynamicYMax = Math.max(GESTURE.dynamicYMax * 0.999, 0.6);

        // Expand bounds immediately if user reaches past them
        if (y < GESTURE.dynamicYMin) GESTURE.dynamicYMin = y;
        if (y > GESTURE.dynamicYMax) GESTURE.dynamicYMax = y;
    };

    const mapGain = (y) => {
        adaptBounds(y);

        // Normalize Y to the currently learned bounds
        let normalizedY = (y - GESTURE.dynamicYMin) / (GESTURE.dynamicYMax - GESTURE.dynamicYMin);
        normalizedY = Math.max(0, Math.min(1, normalizedY)); // Clamp 0-1

        // Invert so UP (low Y) is MAX volume
        const linear = 1.0 - normalizedY;
        const curved = linear * linear; // Exponential curve for natural volume
        return GESTURE.gainRangeMin + curved * (GESTURE.gainRangeMax - GESTURE.gainRangeMin);
    };

    // Left hand
    if (gestures.leftFistClosed !== null) {
        const wasMuted = {};
        leftHandInstruments.forEach(inst => {
            const prevMuted = mutedState[inst] || false;
            const nowMuted = gestures.leftFistClosed;

            // Only call mute/unmute on state CHANGE to avoid fighting with gain
            if (nowMuted !== prevMuted) {
                setStemMuted(inst, nowMuted);
                mutedState[inst] = nowMuted;
            }

            // Only adjust gain when NOT muted
            if (!nowMuted && gestures.leftHandY !== null) {
                setStemGain(inst, mapGain(gestures.leftHandY));
            }
        });
    } else if (gestures.leftHandY !== null) {
        // No fist data but have height — just control gain
        leftHandInstruments.forEach(inst => {
            setStemGain(inst, mapGain(gestures.leftHandY));
        });
    }

    // Right hand
    if (gestures.rightFistClosed !== null) {
        rightHandInstruments.forEach(inst => {
            const prevMuted = mutedState[inst] || false;
            const nowMuted = gestures.rightFistClosed;

            if (nowMuted !== prevMuted) {
                setStemMuted(inst, nowMuted);
                mutedState[inst] = nowMuted;
            }

            if (!nowMuted && gestures.rightHandY !== null) {
                setStemGain(inst, mapGain(gestures.rightHandY));
            }
        });
    } else if (gestures.rightHandY !== null) {
        rightHandInstruments.forEach(inst => {
            setStemGain(inst, mapGain(gestures.rightHandY));
        });
    }

    // Stereo spread: use two-hand distance when available,
    // otherwise use single-hand X position for panning
    if (gestures.handSpread !== null) {
        // Both hands detected — use spread for stereo width
        const panRange = GESTURE.panRange;
        leftHandInstruments.forEach(inst => {
            setStemPan(inst, -(gestures.handSpread * 1.5) * panRange);
        });
        rightHandInstruments.forEach(inst => {
            setStemPan(inst, (gestures.handSpread * 1.5) * panRange);
        });
    } else {
        // Single hand: use hand X position for panning
        if (hands.Left) {
            const leftX = hands.Left[HAND_LANDMARKS.WRIST].x;
            const pan = (leftX - 0.5) * 2 * GESTURE.panRange; // map 0-1 to -panRange..+panRange
            leftHandInstruments.forEach(inst => setStemPan(inst, pan));
        }
        if (hands.Right) {
            const rightX = hands.Right[HAND_LANDMARKS.WRIST].x;
            const pan = (rightX - 0.5) * 2 * GESTURE.panRange;
            rightHandInstruments.forEach(inst => setStemPan(inst, pan));
        }
    }
}

/**
 * Stop hand tracking.
 */
export function stopHandTracker() {
    isRunning = false;
    initCancelled = true;
    if (animFrameId) cancelAnimationFrame(animFrameId);

    if (webcamStream) {
        webcamStream.getTracks().forEach(t => t.stop());
        webcamStream = null;
    }

    smoothedLandmarks = { Left: null, Right: null };
    lastDetectionTimestamp = -1;

    if (handLandmarker) {
        handLandmarker.close();
        handLandmarker = null;
    }
}

/**
 * gesture-mapping.js — Classify hand gestures from landmarks
 *
 * Maps hand positions and finger states to control parameters.
 */

import { HAND_LANDMARKS, GESTURE } from '../shared/constants.js';

/**
 * Classify gestures from hand landmark data.
 * @param {Object} hands - { Left: landmarks[], Right: landmarks[] }
 * @returns {Object} Classified gestures
 */
export function classifyGestures(hands) {
    const result = {
        leftHandY: null,
        rightHandY: null,
        leftFistClosed: null,
        rightFistClosed: null,
        handSpread: null,
        leftFingerSplay: null,
        rightFingerSplay: null
    };

    // Left hand
    if (hands.Left) {
        result.leftHandY = getHandHeight(hands.Left);
        result.leftFistClosed = isFistClosed(hands.Left);
        result.leftFingerSplay = getFingerSplay(hands.Left);
    }

    // Right hand
    if (hands.Right) {
        result.rightHandY = getHandHeight(hands.Right);
        result.rightFistClosed = isFistClosed(hands.Right);
        result.rightFingerSplay = getFingerSplay(hands.Right);
    }

    // Hand spread (distance between wrists)
    if (hands.Left && hands.Right) {
        result.handSpread = getHandSpread(hands.Left, hands.Right);
    }

    return result;
}

/**
 * Get normalized hand height (0=top, 1=bottom).
 * Uses wrist Y coordinate.
 */
function getHandHeight(landmarks) {
    const wrist = landmarks[HAND_LANDMARKS.WRIST];
    return Math.max(0, Math.min(1, wrist.y));
}

/**
 * Determine if hand is making a fist.
 * Fist = 0-1 fingers extended.
 */
function isFistClosed(landmarks) {
    const extended = countExtendedFingers(landmarks);
    return extended <= 1;
}

/**
 * Count extended fingers.
 * A finger is extended if its tip Y is above (less than) its PIP Y.
 */
function countExtendedFingers(landmarks) {
    const fingerPairs = [
        [HAND_LANDMARKS.INDEX_TIP, HAND_LANDMARKS.INDEX_PIP],
        [HAND_LANDMARKS.MIDDLE_TIP, HAND_LANDMARKS.MIDDLE_PIP],
        [HAND_LANDMARKS.RING_TIP, HAND_LANDMARKS.RING_PIP],
        [HAND_LANDMARKS.PINKY_TIP, HAND_LANDMARKS.PINKY_PIP]
    ];

    let count = 0;
    for (const [tipIdx, pipIdx] of fingerPairs) {
        const tip = landmarks[tipIdx];
        const pip = landmarks[pipIdx];
        // In normalized coords, Y increases downward
        // Finger extended if tip is above (lower Y) than PIP
        if (tip.y < pip.y - GESTURE.fingerExtendedThreshold) {
            count++;
        }
    }

    // Thumb: compare tip to IP joint using X distance (thumb extends sideways)
    const thumbTip = landmarks[HAND_LANDMARKS.THUMB_TIP];
    const thumbIP = landmarks[HAND_LANDMARKS.THUMB_IP];
    const thumbExtended = Math.abs(thumbTip.x - thumbIP.x) > 0.04;
    if (thumbExtended) count++;

    return count;
}

/**
 * Get finger splay: sum of distances between adjacent fingertips.
 * Normalized to [0, 1] range.
 */
function getFingerSplay(landmarks) {
    const tips = [
        HAND_LANDMARKS.INDEX_TIP,
        HAND_LANDMARKS.MIDDLE_TIP,
        HAND_LANDMARKS.RING_TIP,
        HAND_LANDMARKS.PINKY_TIP
    ];

    let totalDistance = 0;
    for (let i = 0; i < tips.length - 1; i++) {
        const a = landmarks[tips[i]];
        const b = landmarks[tips[i + 1]];
        totalDistance += Math.sqrt(
            (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
        );
    }

    // Normalize: max splay ~0.4 in normalized coords
    return Math.min(1, totalDistance / 0.35);
}

/**
 * Get spread between two hands (normalized distance).
 */
function getHandSpread(leftLandmarks, rightLandmarks) {
    const leftWrist = leftLandmarks[HAND_LANDMARKS.WRIST];
    const rightWrist = rightLandmarks[HAND_LANDMARKS.WRIST];

    const distance = Math.sqrt(
        (leftWrist.x - rightWrist.x) ** 2 +
        (leftWrist.y - rightWrist.y) ** 2
    );

    // Normalize: hands together ~0, fully apart ~1
    return Math.min(1, distance / 0.6);
}

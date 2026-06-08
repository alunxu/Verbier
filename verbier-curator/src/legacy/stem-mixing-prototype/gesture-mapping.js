/**
 * gesture-mapping.js — Classify hand gestures from landmarks
 *
 * Maps hand positions and finger states to control parameters.
 */

import { HAND_LANDMARKS, GESTURE } from '../../shared/constants.js';

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
 * Determine if hand is making a fist based on finger-to-wrist distances.
 * A fist has most of the fingertips pulled closer to the wrist than their MCP joints.
 */
function isFistClosed(landmarks) {
    const wrist = landmarks[0];
    let foldedCount = 0;
    
    // Check main 4 fingers: Index, Middle, Ring, Pinky
    const tips = [8, 12, 16, 20];
    const mcps = [5, 9, 13, 17];
    
    for (let i = 0; i < 4; i++) {
        const tip = landmarks[tips[i]];
        const mcp = landmarks[mcps[i]];
        
        // Calculate 2D Euclidean distance to the wrist
        const distTipToWrist = Math.sqrt((tip.x - wrist.x)**2 + (tip.y - wrist.y)**2);
        const distMcpToWrist = Math.sqrt((mcp.x - wrist.x)**2 + (mcp.y - wrist.y)**2);
        
        // If the tip is as close (or nearly as close) to the wrist as the knuckle, it is folded.
        // We use a 1.25x scaling factor because fingers can be angled.
        if (distTipToWrist < distMcpToWrist * 1.25) {
            foldedCount++;
        }
    }
    
    // Consider it a closed fist if at least 3 fingers are folded tightly.
    return foldedCount >= 3;
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

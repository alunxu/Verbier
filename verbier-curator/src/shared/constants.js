/**
 * constants.js — Shared constants for Verbier Festival Curator
 */

// Chroma pitch-class to hue mapping (0-360 degrees on color wheel)
// C=0° (red), C#=30°, D=60°, ... B=330°
export const CHROMA_HUE_MAP = [
    0,    // C  - Red
    30,   // C# - Orange-red
    50,   // D  - Orange
    75,   // Eb - Yellow-orange
    100,  // E  - Yellow-green
    140,  // F  - Green
    170,  // F# - Cyan-green
    195,  // G  - Cyan
    220,  // Ab - Blue
    260,  // A  - Blue-violet
    290,  // Bb - Violet
    330   // B  - Magenta
];

// Color palette for landscape
export const PALETTE = {
    skyTop: 0x050a18,
    skyBottom: 0x0d1530,
    terrainBase: 0x1a1a2e,
    terrainLight: 0x2d2d44,
    starColor: 0xaabbff,
    entityGlowColor: 0x7c6cf0,
    entityHoverColor: 0xffffff,
    particleColor: 0xf06c9b,
    ambientLight: 0x334477,
    directionalLight: 0x8899cc
};

// Terrain configuration
export const TERRAIN = {
    width: 120,
    depth: 80,
    segments: 128,
    heightScale: 8,
    noiseFrequency: 0.02,
    noiseOctaves: 4
};

// Entity visual configuration
export const ENTITY = {
    baseRadius: 1.5,
    minRadius: 0.8,
    maxRadius: 3.0,
    breathingSpeed: 1.0,
    breathingAmplitude: 0.15,
    glowIntensity: 0.6,
    haloOpacity: 0.3,
    hoverBrighten: 2.0,
    hoverScale: 1.3,
    segments: 32,  // icosphere detail
    tonnetzDisplacementScale: 0.3
};

// Camera
export const CAMERA = {
    fov: 55,
    near: 0.1,
    far: 500,
    initialPosition: { x: 0, y: 25, z: 50 },
    lookAt: { x: 0, y: 0, z: 0 },
    minDistance: 15,
    maxDistance: 80,
    maxPolarAngle: Math.PI / 2.3
};

// Audio preview
export const AUDIO_PREVIEW = {
    fadeInTime: 0.3,
    fadeOutTime: 0.5,
    maxVolume: 0.5,
    excerptDuration: 15 // seconds
};

// Re-Orchestrate gesture mapping
export const GESTURE = {
    emaAlpha: 0.45,             // Higher = more responsive (was 0.3)
    gainRangeMin: 0.1,          // Minimum gain to avoid accidental silence
    gainRangeMax: 1.0,
    muteTransitionMs: 200,      // Faster mute transitions
    panRange: 0.8,
    reverbRange: { min: 0, max: 0.6 },
    conductingFreqRange: { min: 0.5, max: 4.0 },
    fingerExtendedThreshold: 0.015 // Lower = easier finger detection
};

// MediaPipe hand landmark indices
export const HAND_LANDMARKS = {
    WRIST: 0,
    THUMB_TIP: 4,
    INDEX_TIP: 8,
    MIDDLE_TIP: 12,
    RING_TIP: 16,
    PINKY_TIP: 20,
    INDEX_PIP: 6,
    MIDDLE_PIP: 10,
    RING_PIP: 14,
    PINKY_PIP: 18,
    THUMB_IP: 3
};

// Instrument register classification (for L/R hand assignment)
export const INSTRUMENT_REGISTER = {
    low: ['cello', 'bass', 'bassoon', 'tuba', 'trombone'],
    mid: ['viola', 'horn', 'clarinet', 'oboe', 'trumpet'],
    high: ['violin', 'violin1', 'violin2', 'flute', 'piccolo', 'piano']
};

// Performance budget
export const PERFORMANCE = {
    targetFPS: 60,
    audioLatencyTarget: 50, // ms
    maxMemoryMB: 500,
    particleLimit: 5000
};

// Transition timing
export const TRANSITION = {
    entityGlowDuration: 0.5,
    landscapeFadeDuration: 1.5,
    entityExpandDuration: 1.2,
    loadingMinDuration: 0.5,
    tutorialDuration: 5.0,
    backTransitionDuration: 1.0
};

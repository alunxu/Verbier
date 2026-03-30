/**
 * overlay-renderer.js — Canvas overlay for hand visualization + meters
 *
 * Draws hand skeletons, instrument labels, and visual feedback
 * on a canvas overlaid on the video/performance view.
 */

let canvas = null;
let ctx = null;

// MediaPipe hand connections for skeleton drawing
const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
    [0, 5], [5, 6], [6, 7], [7, 8],       // Index
    [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
    [0, 13], [13, 14], [14, 15], [15, 16],// Ring
    [0, 17], [17, 18], [18, 19], [19, 20],// Pinky
    [5, 9], [9, 13], [13, 17]             // Palm
];

/**
 * Initialize the overlay canvas.
 */
export function initOverlay(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    if (!canvas) return;
    // Use parent container dimensions if available, fall back to window
    const container = canvas.parentElement;
    if (container) {
        canvas.width = container.clientWidth || window.innerWidth;
        canvas.height = container.clientHeight || window.innerHeight;
    } else {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
}

/**
 * Draw hand overlay with skeletons and labels.
 * @param {HTMLCanvasElement} canvasEl - Overlay canvas
 * @param {Object} hands - { Left: landmarks[], Right: landmarks[] }
 * @param {Object} info - { leftInstruments, rightInstruments, gestures }
 */
export function drawHandOverlay(canvasEl, hands, info) {
    if (!ctx) {
        canvas = canvasEl;
        ctx = canvas.getContext('2d');
        resizeCanvas();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each detected hand
    if (hands.Left) {
        drawHandSkeleton(hands.Left, '#4ecdc4', 'Left');
        drawInstrumentLabels(hands.Left, info.leftInstruments, '#4ecdc4', info.gestures?.leftHandY);
    }

    if (hands.Right) {
        drawHandSkeleton(hands.Right, '#f06c9b', 'Right');
        drawInstrumentLabels(hands.Right, info.rightInstruments, '#f06c9b', info.gestures?.rightHandY);
    }
}

function drawHandSkeleton(landmarks, color, handLabel) {
    const w = canvas.width;
    const h = canvas.height;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;

    // Draw connections
    for (const [start, end] of HAND_CONNECTIONS) {
        const a = landmarks[start];
        const b = landmarks[end];

        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
    }

    // Draw landmarks as dots
    ctx.fillStyle = color;
    ctx.shadowBlur = 12;

    for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const radius = [0, 4, 8, 12, 16, 20].includes(i) ? 5 : 3;

        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.shadowBlur = 0;

    // Hand label
    const wrist = landmarks[0];
    ctx.font = '500 11px Inter, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(
        handLabel.toUpperCase(),
        wrist.x * w,
        wrist.y * h + 25
    );
}

function drawInstrumentLabels(landmarks, instruments, color, handY) {
    if (!instruments || instruments.length === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    const wrist = landmarks[0];

    // Position labels near the hand
    const baseX = wrist.x * w;
    const baseY = wrist.y * h - 40;
    const labelHeight = 20;

    ctx.font = '500 12px Inter, sans-serif';
    ctx.textAlign = 'center';

    instruments.forEach((inst, i) => {
        const y = baseY - i * labelHeight;
        const gain = handY !== null ? (1.0 - handY * 0.9) : 0.8;
        const alpha = 0.4 + gain * 0.6;

        // Background pill
        const textWidth = ctx.measureText(inst.toUpperCase()).width + 16;
        ctx.fillStyle = `rgba(15, 25, 60, ${alpha * 0.8})`;
        ctx.beginPath();
        ctx.roundRect(baseX - textWidth / 2, y - 12, textWidth, 20, 8);
        ctx.fill();

        // Border
        ctx.strokeStyle = `${color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Text
        ctx.fillStyle = `${color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
        ctx.fillText(inst.toUpperCase(), baseX, y + 2);
    });
}

/**
 * Clear the overlay canvas.
 */
export function clearOverlay() {
    if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    window.removeEventListener('resize', resizeCanvas);
}

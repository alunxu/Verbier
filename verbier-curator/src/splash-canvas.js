/**
 * splash-canvas.js — Full-screen animated canvas for the splash screen.
 *
 * Renders: flowing staff lines, floating musical glyphs, orbiting particles,
 * bright color fields, interconnection lines, and subtle waveforms.
 * All elements are significantly brighter and more vivid for visual impact.
 */

const MUSICAL_GLYPHS = ['♩', '♪', '♫', '♬', '𝄞', '𝄢', '𝄡', '♭', '♯', '♮',
    '𝅝', '𝅗𝅥', '𝅘𝅥', '𝅘𝅥𝅮', '𝅘𝅥𝅯'];

// Vivid, bright and high-contrast colors
const COLORS = {
    purple: [124, 108, 240],
    pink: [240, 108, 155],
    gold: [255, 190, 60],
    teal: [78, 220, 200],
    white: [232, 234, 246],
    coral: [255, 127, 95],
    lavender: [180, 140, 255],
    navy: [13, 30, 58],        // Deep contrast
    deepRed: [130, 20, 50]     // Deep contrast
};

function rgba(color, alpha) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

let canvas, ctx, width, height, animId;
let particles = [];
let staffWaves = [];
let glyphs = [];
let orbs = [];
let beams = [];
let time = 0;

export function initSplashCanvas() {
    canvas = document.getElementById('splash-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    createParticles();
    createStaffWaves();
    createGlyphs();
    createOrbs();
    createBeams();
    animate();
}

export function destroySplashCanvas() {
    if (animId) cancelAnimationFrame(animId);
    window.removeEventListener('resize', resize);
}

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}

// ────────────────────────────────────────────────────────────
// Floating sparkle particles (rose-gold, brighter)
// ────────────────────────────────────────────────────────────
function createParticles() {
    particles = [];
    const count = Math.min(133, Math.floor(width * height / 12000));
    const colorChoices = [COLORS.purple, COLORS.gold, COLORS.teal, COLORS.pink, COLORS.lavender, COLORS.coral];
    for (let i = 0; i < count; i++) {
        particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            r: 1.5 + Math.random() * 3.5,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -0.2 - Math.random() * 0.45,
            alpha: 0.6 + Math.random() * 0.4,
            pulse: Math.random() * Math.PI * 2,
            color: colorChoices[Math.floor(Math.random() * colorChoices.length)]
        });
    }
}

// ────────────────────────────────────────────────────────────
// Flowing staff-like wave lines (sinusoidal, organic)
// ────────────────────────────────────────────────────────────
function createStaffWaves() {
    staffWaves = [];
    const lines = 5;
    const baseY = height * 0.5;
    const gap = 16;
    for (let i = 0; i < lines; i++) {
        staffWaves.push({
            baseY: baseY + (i - 2) * gap,
            amplitude: 24 + Math.random() * 16,
            frequency: 0.003 + Math.random() * 0.002,
            phase: Math.random() * Math.PI * 2,
            speed: 0.3 + Math.random() * 0.4,
            alpha: 0.2 + Math.random() * 0.15
        });
    }
}

// ────────────────────────────────────────────────────────────
// Floating musical glyphs — HIGH VISIBILITY
// ────────────────────────────────────────────────────────────
function createGlyphs() {
    glyphs = [];
    const count = 22;
    const colorChoices = [COLORS.purple, COLORS.teal, COLORS.pink, COLORS.lavender, COLORS.coral, COLORS.gold];
    for (let i = 0; i < count; i++) {
        const size = 35 + Math.random() * 60; // larger
        glyphs.push({
            x: Math.random() * width,
            y: Math.random() * height,
            char: MUSICAL_GLYPHS[Math.floor(Math.random() * MUSICAL_GLYPHS.length)],
            size,
            rotation: (Math.random() - 0.5) * 0.6,
            rotationSpeed: (Math.random() - 0.5) * 0.006,
            vx: (Math.random() - 0.5) * 0.5,
            vy: -0.25 - Math.random() * 0.45,
            alpha: 0.75 + Math.random() * 0.25,   // heavily opaque
            pulsePhase: Math.random() * Math.PI * 2,
            pulseSpeed: 0.5 + Math.random() * 0.8,
            color: colorChoices[Math.floor(Math.random() * colorChoices.length)],
            glowRadius: 15 + Math.random() * 35
        });
    }
}

// ────────────────────────────────────────────────────────────
// Soft glowing orb fields — brighter, more vivid
// ────────────────────────────────────────────────────────────
function createOrbs() {
    orbs = [];
    const orbDefs = [
        { x: 0.15, y: 0.25, r: 300, color: COLORS.purple, alpha: 0.12 },
        { x: 0.75, y: 0.6, r: 350, color: COLORS.pink, alpha: 0.09 },
        { x: 0.5, y: 0.15, r: 250, color: COLORS.gold, alpha: 0.08 },
        { x: 0.85, y: 0.3, r: 220, color: COLORS.teal, alpha: 0.07 },
        { x: 0.1, y: 0.7, r: 260, color: COLORS.lavender, alpha: 0.08 },
        { x: 0.6, y: 0.8, r: 200, color: COLORS.coral, alpha: 0.06 },
    ];
    orbDefs.forEach(o => {
        orbs.push({
            x: o.x * width, y: o.y * height,
            baseX: o.x * width, baseY: o.y * height,
            r: o.r, color: o.color, alpha: o.alpha,
            phase: Math.random() * Math.PI * 2,
            driftSpeed: 0.1 + Math.random() * 0.15
        });
    });
}

// ────────────────────────────────────────────────────────────
// Light beams (sweeping diagonals of light)
// ────────────────────────────────────────────────────────────
function createBeams() {
    beams = [];
    for (let i = 0; i < 4; i++) {
        beams.push({
            x: Math.random() * width,
            angle: -0.3 + Math.random() * 0.6,
            width: 80 + Math.random() * 120,
            speed: 0.2 + Math.random() * 0.3,
            alpha: 0.015 + Math.random() * 0.02,
            color: [COLORS.purple, COLORS.pink, COLORS.gold, COLORS.lavender][i],
            drift: Math.random() * Math.PI * 2
        });
    }
}

// ────────────────────────────────────────────────────────────
// Draw functions
// ────────────────────────────────────────────────────────────

function drawOrbs() {
    orbs.forEach(o => {
        o.x = o.baseX + Math.sin(time * o.driftSpeed + o.phase) * 50;
        o.y = o.baseY + Math.cos(time * o.driftSpeed * 0.7 + o.phase) * 35;
        const pulseAlpha = o.alpha * (0.7 + 0.3 * Math.sin(time * 0.5 + o.phase));
        const gradient = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        gradient.addColorStop(0, rgba(o.color, pulseAlpha));
        gradient.addColorStop(0.5, rgba(o.color, pulseAlpha * 0.3));
        gradient.addColorStop(1, rgba(o.color, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2);
    });
}

function drawBeams() {
    beams.forEach(b => {
        b.x += Math.sin(time * b.speed + b.drift) * 0.8;
        const x = b.x + Math.sin(time * b.speed + b.drift) * 200;
        ctx.save();
        ctx.translate(x, 0);
        ctx.rotate(b.angle);
        const gradient = ctx.createLinearGradient(-b.width / 2, 0, b.width / 2, 0);
        gradient.addColorStop(0, rgba(b.color, 0));
        gradient.addColorStop(0.5, rgba(b.color, b.alpha));
        gradient.addColorStop(1, rgba(b.color, 0));
        ctx.fillStyle = gradient;
        ctx.fillRect(-b.width / 2, -100, b.width, height + 200);
        ctx.restore();
    });
}

function drawStaffWaves() {
    staffWaves.forEach(w => {
        ctx.beginPath();
        ctx.strokeStyle = rgba(COLORS.purple, w.alpha);
        ctx.lineWidth = 1.2;
        for (let x = 0; x <= width; x += 3) {
            const y = w.baseY +
                Math.sin(x * w.frequency + time * w.speed + w.phase) * w.amplitude +
                Math.sin(x * w.frequency * 2.3 + time * w.speed * 0.7) * w.amplitude * 0.3;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    });
}

function drawParticles() {
    particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) { p.y = height + 10; p.x = Math.random() * width; }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;

        const pulse = 0.5 + 0.5 * Math.sin(time * 2.5 + p.pulse);
        const alpha = p.alpha * (0.5 + pulse * 0.5);
        const r = p.r * (0.8 + pulse * 0.4);

        // Glow layer
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.color, alpha * 0.15);
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.color, alpha);
        ctx.fill();
    });
}

function drawGlyphs() {
    glyphs.forEach(g => {
        g.x += g.vx;
        g.y += g.vy;
        g.rotation += g.rotationSpeed;

        if (g.y < -80) { g.y = height + 80; g.x = Math.random() * width; }
        if (g.x < -80) g.x = width + 80;
        if (g.x > width + 80) g.x = -80;

        const pulse = 0.55 + 0.45 * Math.sin(time * g.pulseSpeed + g.pulsePhase);
        const alpha = g.alpha * pulse;

        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.rotation);

        // High contrast white glow behind glyph
        ctx.shadowColor = rgba(COLORS.white, 0.9);
        ctx.shadowBlur = g.glowRadius * pulse;

        ctx.font = `${g.size}px 'Cormorant Garamond', serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = rgba(g.color, alpha);
        ctx.fillText(g.char, 0, 0);

        ctx.shadowBlur = 0;
        ctx.restore();
    });
}

function drawWaveform() {
    const waveY = height * 0.82;
    const waveWidth = width * 0.55;
    const startX = (width - waveWidth) / 2;

    ctx.beginPath();
    ctx.strokeStyle = rgba(COLORS.pink, 0.08);
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= waveWidth; i += 2) {
        const t2 = i / waveWidth;
        const amplitude = 14 * Math.sin(t2 * Math.PI);
        const y = waveY +
            Math.sin(t2 * 30 + time * 2) * amplitude +
            Math.sin(t2 * 60 + time * 3) * amplitude * 0.3;
        if (i === 0) ctx.moveTo(startX + i, y);
        else ctx.lineTo(startX + i, y);
    }
    ctx.stroke();
}

function drawConnectionLines() {
    for (let i = 0; i < glyphs.length; i++) {
        for (let j = i + 1; j < glyphs.length; j++) {
            const dx = glyphs[i].x - glyphs[j].x;
            const dy = glyphs[i].y - glyphs[j].y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 220) {
                const alpha = (1 - dist / 220) * 0.06;
                ctx.beginPath();
                ctx.strokeStyle = rgba(COLORS.lavender, alpha);
                ctx.lineWidth = 0.6;
                ctx.moveTo(glyphs[i].x, glyphs[i].y);
                ctx.lineTo(glyphs[j].x, glyphs[j].y);
                ctx.stroke();
            }
        }
    }
}

// ────────────────────────────────────────────────────────────
// Treble clef watermark (large, centered, very subtle)
// ────────────────────────────────────────────────────────────
function drawTrebleClefWatermark() {
    const pulse = 0.03 + 0.015 * Math.sin(time * 0.3);
    ctx.save();
    ctx.translate(width * 0.5, height * 0.48);
    ctx.font = `${Math.min(width, height) * 0.45}px 'Cormorant Garamond', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = rgba(COLORS.purple, pulse);
    ctx.fillText('𝄞', 0, 0);
    ctx.restore();
}

// ────────────────────────────────────────────────────────────
// Animation loop
// ────────────────────────────────────────────────────────────
function animate() {
    animId = requestAnimationFrame(animate);
    time += 0.016;

    ctx.clearRect(0, 0, width, height);

    drawTrebleClefWatermark();
    drawOrbs();
    drawBeams();
    drawConnectionLines();
    drawStaffWaves();
    drawWaveform();
    drawParticles();
    drawGlyphs();
}

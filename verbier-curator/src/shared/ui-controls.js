/**
 * ui-controls.js — Shared UI elements
 *
 * Loading overlays, tooltips, settings panel.
 */

/**
 * Show loading overlay with message.
 */
export function showLoading(message = 'Loading...', progress = 0) {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');
    const bar = document.getElementById('loading-bar');

    if (overlay) overlay.classList.remove('hidden');
    if (text) text.textContent = message;
    if (bar) bar.style.width = `${progress}%`;
}

/**
 * Update loading progress.
 */
export function updateLoading(message, progress) {
    const text = document.getElementById('loading-text');
    const bar = document.getElementById('loading-bar');

    if (text && message) text.textContent = message;
    if (bar) bar.style.width = `${progress}%`;
}

/**
 * Hide loading overlay.
 */
export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
}

/**
 * Show a transient toast notification.
 */
export function showToast(message, duration = 3000) {
    const existing = document.getElementById('toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
    position: fixed;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    padding: 12px 24px;
    background: rgba(15, 25, 60, 0.9);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(124, 108, 240, 0.2);
    border-radius: 12px;
    color: #e8eaf6;
    font-family: 'Inter', sans-serif;
    font-size: 0.85rem;
    z-index: 9999;
    opacity: 0;
    transition: opacity 300ms, transform 300ms;
  `;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

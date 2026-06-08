/**
 * video-player.js — Video element management + sync
 *
 * Manages the performance video playback and syncs to audio position.
 */

import { getCurrentTime, getDuration } from './stem-mixer.js';

let videoElement = null;
let syncInterval = null;

/**
 * Initialize video player.
 * @param {Object} performance - Performance object with video_url
 * @param {HTMLElement} container - Video layer container
 * @returns {boolean} true if video loaded successfully
 */
export function initVideoPlayer(performance, container) {
    if (!performance.video_url) {
        // No video: show abstract visualization placeholder
        showPlaceholder(container, performance);
        return false;
    }

    videoElement = document.createElement('video');
    videoElement.src = performance.video_url;
    videoElement.muted = true; // Audio comes from stem mixer
    videoElement.playsInline = true;
    videoElement.preload = 'auto';
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.style.objectFit = 'contain';

    container.innerHTML = '';
    container.appendChild(videoElement);

    return true;
}

/**
 * Start video playback, synced to audio.
 */
export function startVideoSync() {
    if (!videoElement) return;

    videoElement.play().catch(e => {
        console.warn('Video autoplay blocked:', e);
    });

    // Sync video to audio time every 500ms
    syncInterval = setInterval(() => {
        const audioTime = getCurrentTime();
        if (Math.abs(videoElement.currentTime - audioTime) > 0.3) {
            videoElement.currentTime = audioTime;
        }
    }, 500);
}

/**
 * Stop video playback.
 */
export function stopVideoSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    if (videoElement) {
        videoElement.pause();
    }
}

/**
 * Show a placeholder when no video is available.
 * Creates an abstract waveform/gradient visualization.
 */
function showPlaceholder(container, performance) {
    container.innerHTML = '';

    const placeholder = document.createElement('div');
    placeholder.style.cssText = `
    width: 100%; height: 100%;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: linear-gradient(135deg, #050a18 0%, #0d1530 40%, #1a0a30 100%);
    position: relative;
    overflow: hidden;
  `;

    // Animated background circles
    for (let i = 0; i < 5; i++) {
        const circle = document.createElement('div');
        const size = 100 + i * 120;
        circle.style.cssText = `
      position: absolute;
      width: ${size}px; height: ${size}px;
      border-radius: 50%;
      border: 1px solid rgba(124, 108, 240, ${0.08 - i * 0.01});
      animation: pulse-ring ${3 + i * 0.8}s ease-in-out infinite;
      animation-delay: ${i * 0.4}s;
    `;
        placeholder.appendChild(circle);
    }

    // Add title overlay
    const titleEl = document.createElement('div');
    titleEl.style.cssText = `
    z-index: 2; text-align: center;
    font-family: 'Outfit', sans-serif;
  `;
    titleEl.innerHTML = `
    <div style="font-size: 0.7rem; color: rgba(124,108,240,0.8); text-transform: uppercase; letter-spacing: 0.2em; margin-bottom: 8px;">
      Now Playing
    </div>
    <div style="font-size: 1.6rem; font-weight: 600; color: #e8eaf6; margin-bottom: 4px;">
      ${performance.title}
    </div>
    <div style="font-size: 1rem; color: rgba(232,234,246,0.6);">
      ${performance.composer}
    </div>
  `;
    placeholder.appendChild(titleEl);

    // CSS animation
    const style = document.createElement('style');
    style.textContent = `
    @keyframes pulse-ring {
      0%, 100% { transform: scale(1); opacity: 0.5; }
      50% { transform: scale(1.15); opacity: 1; }
    }
  `;
    placeholder.appendChild(style);

    container.appendChild(placeholder);
}

/**
 * Clean up video player.
 */
export function disposeVideoPlayer() {
    stopVideoSync();
    if (videoElement) {
        videoElement.src = '';
        videoElement.remove();
        videoElement = null;
    }
}

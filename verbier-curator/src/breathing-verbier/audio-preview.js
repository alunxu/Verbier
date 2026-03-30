/**
 * audio-preview.js — Hover audio preview player using Web Audio API
 *
 * Loads and plays short audio excerpts when user hovers over entities.
 * Implements crossfading between excerpts.
 */

import { AUDIO_PREVIEW } from '../shared/constants.js';

export class AudioPreviewPlayer {
    constructor(audioContext) {
        this.ctx = audioContext;
        this.gainNode = this.ctx.createGain();
        this.gainNode.gain.value = 0;
        this.gainNode.connect(this.ctx.destination);

        this.currentSource = null;
        this.bufferCache = new Map();
        this.isPlaying = false;
    }

    /**
     * Play an audio excerpt.
     * @param {string} url - Audio file URL
     * @param {Object} excerpt - { start_sec, end_sec }
     */
    async play(url, excerpt = {}) {
        try {
            // Load buffer
            let buffer = this.bufferCache.get(url);
            if (!buffer) {
                const response = await fetch(url);
                if (!response.ok) return;
                const arrayBuffer = await response.arrayBuffer();
                buffer = await this.ctx.decodeAudioData(arrayBuffer);
                this.bufferCache.set(url, buffer);
            }

            // Stop current
            this.stopSource();

            // Create source
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.gainNode);
            source.loop = true;

            const startSec = excerpt.start_sec ?? 0;
            const endSec = excerpt.end_sec ?? Math.min(startSec + AUDIO_PREVIEW.excerptDuration, buffer.duration);
            const duration = endSec - startSec;

            source.loopStart = startSec;
            source.loopEnd = endSec;
            source.start(0, startSec);

            this.currentSource = source;
            this.isPlaying = true;

            // Fade in
            this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
            this.gainNode.gain.setTargetAtTime(
                AUDIO_PREVIEW.maxVolume,
                this.ctx.currentTime,
                AUDIO_PREVIEW.fadeInTime
            );
        } catch (e) {
            console.warn('Audio preview error:', e);
        }
    }

    /**
     * Stop current playback with fade-out.
     */
    stop() {
        if (!this.isPlaying) return;

        this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gainNode.gain.setTargetAtTime(
            0,
            this.ctx.currentTime,
            AUDIO_PREVIEW.fadeOutTime
        );

        // Stop source after fade
        const source = this.currentSource;
        setTimeout(() => {
            try { source?.stop(); } catch (e) { /* already stopped */ }
        }, AUDIO_PREVIEW.fadeOutTime * 3 * 1000);

        this.currentSource = null;
        this.isPlaying = false;
    }

    stopSource() {
        if (this.currentSource) {
            try { this.currentSource.stop(); } catch (e) { /* ok */ }
            this.currentSource = null;
        }
        this.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        this.gainNode.gain.value = 0;
        this.isPlaying = false;
    }

    dispose() {
        this.stopSource();
        this.bufferCache.clear();
        this.gainNode.disconnect();
    }
}

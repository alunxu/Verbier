/**
 * transition.js — Cinematic transitions between Part 1 and Part 2
 *
 * Handles the visual morph from landscape entity to performance view and back.
 */

import { TRANSITION } from './constants.js';

/**
 * Play transition from Breathing Verbier to Re-Orchestrate.
 * @param {Object} performance - Selected performance
 */
export async function playTransitionToReOrchestrate(performance) {
    const canvasContainer = document.getElementById('canvas-container');
    const reContainer = document.getElementById('re-orchestrate-container');

    return new Promise(resolve => {
        // Phase 1: Fade out landscape
        canvasContainer.style.transition = `opacity ${TRANSITION.landscapeFadeDuration}s cubic-bezier(0.25, 0.1, 0.25, 1)`;
        canvasContainer.style.opacity = '0';

        setTimeout(() => {
            canvasContainer.style.display = 'none';

            // Phase 2: Fade in re-orchestrate
            reContainer.style.opacity = '0';
            reContainer.classList.add('active');

            requestAnimationFrame(() => {
                reContainer.style.transition = `opacity ${TRANSITION.entityExpandDuration}s cubic-bezier(0.25, 0.1, 0.25, 1)`;
                reContainer.style.opacity = '1';
            });

            setTimeout(() => {
                resolve();
            }, TRANSITION.entityExpandDuration * 1000);

        }, TRANSITION.landscapeFadeDuration * 1000);
    });
}

/**
 * Play reverse transition from Re-Orchestrate back to Breathing Verbier.
 */
export async function playTransitionToLandscape() {
    const canvasContainer = document.getElementById('canvas-container');
    const reContainer = document.getElementById('re-orchestrate-container');

    return new Promise(resolve => {
        // Phase 1: Fade out re-orchestrate
        reContainer.style.transition = `opacity ${TRANSITION.backTransitionDuration}s cubic-bezier(0.25, 0.1, 0.25, 1)`;
        reContainer.style.opacity = '0';

        setTimeout(() => {
            reContainer.classList.remove('active');

            // Phase 2: Fade in landscape
            canvasContainer.style.display = 'block';
            requestAnimationFrame(() => {
                canvasContainer.style.transition = `opacity ${TRANSITION.backTransitionDuration}s cubic-bezier(0.25, 0.1, 0.25, 1)`;
                canvasContainer.style.opacity = '1';
            });

            setTimeout(() => {
                resolve();
            }, TRANSITION.backTransitionDuration * 1000);
        }, TRANSITION.backTransitionDuration * 1000);
    });
}

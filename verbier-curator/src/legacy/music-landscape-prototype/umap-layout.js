/**
 * umap-layout.js — Maps UMAP 2D coordinates to 3D terrain positions
 */

import { TERRAIN } from '../../shared/constants.js';

/**
 * Load UMAP positions from JSON and merge into performances.
 * @param {string} url - URL to umap_positions.json
 * @param {Array} performances - Performance array to augment
 * @returns {Promise<Array>} Performances with umap_position set
 */
export async function loadAndApplyUmapLayout(url, performances) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const positions = await resp.json();

        performances.forEach(perf => {
            const key = perf.id.replace('urmp_', 'urmp_') // normalize
                || perf.id;

            // Try to find matching UMAP position
            for (const [posKey, pos] of Object.entries(positions)) {
                if (perf.id.includes(posKey) || posKey.includes(perf.id)) {
                    perf.umap_position = pos;
                    return;
                }
            }
        });

        return performances;
    } catch (e) {
        console.warn('Failed to load UMAP positions:', e);
        return performances;
    }
}

/**
 * Convert UMAP [0,1] coordinate to world 3D position.
 * @param {number} umapX - UMAP x coordinate [0,1]
 * @param {number} umapY - UMAP y coordinate [0,1]
 * @returns {{ x: number, y: number, z: number }}
 */
export function umapToWorld(umapX, umapY) {
    return {
        x: (umapX - 0.5) * TERRAIN.width * 0.7,
        z: (umapY - 0.5) * TERRAIN.depth * 0.7,
        y: 0 // Caller adds terrain height
    };
}

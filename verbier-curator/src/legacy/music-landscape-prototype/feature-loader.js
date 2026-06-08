/**
 * feature-loader.js — Load and cache audio feature JSON files
 */

const cache = new Map();

/**
 * Load feature timeseries for a performance.
 * @param {string} url - URL to feature JSON file
 * @returns {Promise<Object>} Feature data with timeseries and summary
 */
export async function loadFeatures(url) {
    if (cache.has(url)) return cache.get(url);

    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        cache.set(url, data);
        return data;
    } catch (e) {
        console.warn(`Failed to load features from ${url}:`, e);
        return null;
    }
}

/**
 * Interpolate a timeseries value at a given time.
 * @param {number[]} series - Timeseries array
 * @param {number} fps - Frames per second of the timeseries
 * @param {number} time - Current time in seconds
 * @returns {number} Interpolated value
 */
export function interpolateTimeseries(series, fps, time) {
    const frameIndex = time * fps;
    const i0 = Math.floor(frameIndex);
    const i1 = Math.min(i0 + 1, series.length - 1);
    const t = frameIndex - i0;

    if (i0 < 0 || i0 >= series.length) return series[series.length - 1] ?? 0;
    return series[i0] * (1 - t) + series[i1] * t;
}

/**
 * Clear the feature cache (for memory management).
 */
export function clearFeatureCache() {
    cache.clear();
}

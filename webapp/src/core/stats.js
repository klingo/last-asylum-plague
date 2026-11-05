/**
 * Small statistics shared by the fit (point-fit.js) and the schedule forecast (schedule.js). Both return NaN for an
 * empty list. Pure module (no DOM/i18n), shared with Node scripts.
 */

/** The middle value of a list (the mean of the two middle ones for an even count). */
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length === 0 ? NaN : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The value at fraction `q` (0 to 1) of the sorted list, e.g. 0.9 for the 90th percentile. */
function quantile(values, q) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

export { median, quantile };

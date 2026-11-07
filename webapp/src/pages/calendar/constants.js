/**
 * The charts' windows.
 */

// The schedule timeline: the current week and the 3 weeks ahead (Monday to Sunday).
const WEEKS = 4;

// Weekday offers (and the event rotations): today and the next 6 days (game days: they start at 02:00 UTC).
const ROTATION_DAYS = 7;
const HOUR_MS = 3600000;

export { HOUR_MS, ROTATION_DAYS, WEEKS };

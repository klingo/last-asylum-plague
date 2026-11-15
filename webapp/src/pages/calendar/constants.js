/**
 * The charts' windows.
 */

// The schedule timeline: the current local week and the 3 weeks ahead (Monday to Sunday).
const WEEKS = 4;

// Weekday offers: today and the next 6 local days.
const ROTATION_DAYS = 7;

// Event rotations: the slot on now and the hours after it.
const EVENT_ROTATION_HOURS = 24;

// Event rotations of day-long slots (the Alliance Duel) show today and the next 6 days (`ROTATION_DAYS`) instead.
const EVENT_ROTATION_DAY_HOURS = 24;

// The Kingdom War: the current local week and the 3 after it, Monday to Sunday.
const KINGDOM_WAR_WEEKS = 4;

export { EVENT_ROTATION_DAY_HOURS, EVENT_ROTATION_HOURS, KINGDOM_WAR_WEEKS, ROTATION_DAYS, WEEKS };

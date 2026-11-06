/**
 * Dates and times as the pages show them, in the language's format: the game's dates (a day number, the same date in
 * any time zone) and moments in the user's local time.
 */
import { getLocale } from './i18n.js';
import { dayDate } from '../core/schedule.js';

/** A number as two digits ("05"). */
const pad2 = (n) => String(n).padStart(2, '0');

/** "Mon, Oct 12" (a game day number, shown as the game's date in any time zone). */
function formatGameDay(day, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
    return dayDate(day).toLocaleDateString(getLocale(), { timeZone: 'UTC', ...options });
}

/** "Mon, Oct 12 – Tue, Oct 13" (one date for a one-day run): the game days `start`..`end`. */
function formatGameDayRange(start, end, options) {
    return start === end
        ? formatGameDay(start, options)
        : `${formatGameDay(start, options)} – ${formatGameDay(end, options)}`;
}

/** "04:00" in local time. */
function formatClock(ms) {
    return new Date(ms).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** "Sun, Oct 25, 04:00" in local time. */
function formatMoment(ms) {
    return new Date(ms).toLocaleString(getLocale(), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export { pad2, formatGameDay, formatGameDayRange, formatClock, formatMoment };

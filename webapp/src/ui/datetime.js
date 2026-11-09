/**
 * Dates and times as the pages show them, in the language's format and the user's local time (the game's days stay
 * internal: a run is shown from the moment it starts to the moment it ends).
 */
import { runMoments } from '../core/schedule.js';
import { getLocale, t } from './i18n.js';

/** A number as two digits ("05"). */
const pad2 = (n) => String(n).padStart(2, '0');

/** "Mon, Oct 12" in local time: the date of a moment. */
function formatDate(ms, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
    return new Date(ms).toLocaleDateString(getLocale(), options);
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

/**
 * "Tue, Nov 3 · 04:00 – 08:00" for a run within one local day (it may end at midnight), else
 * "Mon, Oct 12, 04:00 – Mon, Oct 19, 04:00": when a run (or a slot of an event rotation) starts and ends, `startMs` /
 * `endMs` in local time.
 */
function formatRunRange(startMs, endMs) {
    const start = new Date(startMs);
    const nextMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime();
    return endMs <= nextMidnight
        ? `${formatDate(startMs)} · ${formatClock(startMs)} – ${formatClock(endMs)}`
        : `${formatMoment(startMs)} – ${formatMoment(endMs)}`;
}

/** "Mon, 12 Oct, 04:00 – Mon, 19 Oct, 04:00 (7 days)": a run of game days (`start` / `end` day numbers) as the moments it starts and ends. */
function formatRunDays(run) {
    const { start, end } = runMoments(run);
    const days = run.end - run.start + 1;
    return `${formatRunRange(start, end)} (${days === 1 ? t('calendar.schedule.oneDay') : t('calendar.schedule.days', { count: days })})`;
}

export { pad2, formatDate, formatClock, formatMoment, formatRunRange, formatRunDays };

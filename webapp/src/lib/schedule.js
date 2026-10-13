/**
 * The recorded schedule (`schedule` in pack_data.json: per id its runs as inclusive start/end dates) as day
 * numbers, plus a simple forecast for ids that ran at least twice. Days are whole numbers (days since 1970-01-01),
 * so time zones and daylight saving can't shift them.
 */

const DAY_MS = 86400000;

/** "2026-10-12" -> day number. */
function dayNumber(text) {
    const [year, month, day] = text.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Day number -> a Date at midnight UTC (format it with `timeZone: 'UTC'`). */
function dayDate(day) {
    return new Date(day * DAY_MS);
}

/** Day number of a local date (e.g. today). */
function localDayNumber(date) {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/** Monday = 0 ... Sunday = 6. */
function weekdayIndex(day) {
    return (dayDate(day).getUTCDay() + 6) % 7;
}

/** ISO week number of a day (the week's Thursday decides its year). */
function isoWeekNumber(day) {
    const thursday = day - weekdayIndex(day) + 3;
    const year = dayDate(thursday).getUTCFullYear();
    return Math.floor((thursday - dayNumber(`${year}-01-01`)) / 7) + 1;
}

/**
 * id -> { kind, runs: [{ start, end }] } (inclusive day numbers, oldest first). kind: 'event', 'ingame' (events
 * with category "ingame_event"), 'pass' (seasonal pass families) or 'track' (spend reward tracks).
 */
function scheduleRuns(data) {
    const result = new Map();
    for (const [id, runs] of Object.entries(data.schedule || {})) {
        let kind = 'pass';
        if (data.events?.[id]) {
            kind = data.events[id].category === 'ingame_event' ? 'ingame' : 'event';
        } else if (data.spend_reward_tracks?.[id]) {
            kind = 'track';
        }
        const days = runs
            .map((run) => ({ start: dayNumber(run.start), end: dayNumber(run.end) }))
            .sort((a, b) => a.start - b.start);
        result.set(id, { kind, runs: days });
    }
    return result;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The next runs of an id that ran at least twice, repeating its usual rhythm (median days between run starts,
 * median run length) after its last run, within [from, to] and not ended before `today`:
 * [{ start, end, intervalDays, last: { start, end } }].
 */
function forecastRuns(runs, { from, to, today }) {
    if (runs.length < 2) {
        return [];
    }
    const interval = Math.round(median(runs.slice(1).map((run, index) => run.start - runs[index].start)));
    const length = Math.min(Math.round(median(runs.map((run) => run.end - run.start + 1))), interval);
    const last = runs[runs.length - 1];
    const forecast = [];
    for (let start = last.start + interval; start <= to; start += interval) {
        const end = start + length - 1;
        if (start > last.end && end >= from && end >= today) {
            forecast.push({ start, end, intervalDays: interval, last });
        }
    }
    return forecast;
}

export { dayDate, localDayNumber, weekdayIndex, isoWeekNumber, scheduleRuns, forecastRuns };

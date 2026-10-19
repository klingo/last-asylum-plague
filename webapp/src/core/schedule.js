/**
 * The recorded schedule (`schedule` in pack_data.json: per id its runs as inclusive start/end dates) as day
 * numbers, plus a simple forecast for ids that ran at least twice. Days are whole numbers (days since 1970-01-01),
 * so time zones and daylight saving can't shift them.
 */

const DAY_MS = 86400000;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** "2026-10-12" -> day number. */
function dayNumber(text) {
    const [year, month, day] = text.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** Day number -> a Date at midnight UTC (format it with `timeZone: 'UTC'`). */
function dayDate(day) {
    return new Date(day * DAY_MS);
}

// The game's day starts (and ends) at 02:00 UTC, whatever the local time zone or daylight saving.
const GAME_DAY_START_MS = 2 * 3600000;

/**
 * The game day a moment falls in: its day number (the date it started on) and how far into it the moment is
 * (0 ≤ fraction < 1). 01:00 UTC on Oct 18 is still the game day Oct 17, 23/24 through.
 */
function gameDay(date) {
    const shifted = date.getTime() - GAME_DAY_START_MS;
    const day = Math.floor(shifted / DAY_MS);
    return { day, fraction: (shifted - day * DAY_MS) / DAY_MS };
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
 * with category "ingame_event"), 'pass' (seasonal pass families) or 'track' (spend reward tracks, and events with
 * `calendar_group: "spend_rewards"`).
 */
function scheduleRuns(data) {
    const result = new Map();
    for (const [id, runs] of Object.entries(data.schedule || {})) {
        let kind = 'pass';
        if (data.events?.[id]) {
            const event = data.events[id];
            if (event.calendar_group === 'spend_rewards') {
                kind = 'track';
            } else {
                kind = event.category === 'ingame_event' ? 'ingame' : 'event';
            }
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

/** The days in [from, to] on one of the given weekdays ("monday", ...), consecutive days merged into runs. */
function weekdayRuns(availableDays, from, to) {
    const wanted = new Set((availableDays || []).map((name) => WEEKDAYS.indexOf(name)));
    const runs = [];
    for (let day = from; day <= to; day += 1) {
        if (wanted.has(weekdayIndex(day))) {
            const last = runs[runs.length - 1];
            if (last && last.end === day - 1) {
                last.end = day;
            } else {
                runs.push({ start: day, end: day });
            }
        }
    }
    return runs;
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

/**
 * Where an id's runs stand on `today`: the run on now (`running`, `days` left after today: 0 = ends today), else the
 * next one (`upcoming`, `days` until it starts), else the last one (`ended`, `days` since it ended). Null without
 * runs. Forecasts aren't runs: pass them in to count them too.
 */
function runStatus(runs, today) {
    const running = runs.find((run) => run.start <= today && today <= run.end);
    if (running) {
        return { state: 'running', run: running, days: running.end - today };
    }
    const upcoming = runs.filter((run) => run.start > today).sort((a, b) => a.start - b.start)[0];
    if (upcoming) {
        return { state: 'upcoming', run: upcoming, days: upcoming.start - today };
    }
    const ended = runs.filter((run) => run.end < today).sort((a, b) => b.end - a.end)[0];
    return ended ? { state: 'ended', run: ended, days: today - ended.end } : null;
}

export {
    dayDate,
    gameDay,
    GAME_DAY_START_MS,
    weekdayIndex,
    isoWeekNumber,
    scheduleRuns,
    forecastRuns,
    weekdayRuns,
    runStatus,
};

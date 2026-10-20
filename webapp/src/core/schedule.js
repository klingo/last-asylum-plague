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
 * The shortest cycle of gaps (days between run starts) that explains every recorded gap (gaps[i] = gaps[i - k]),
 * once it has proven itself: seen twice (n ≥ 2k), or whole weeks long with at least one gap repeated (n ≥ k + 1;
 * game events follow the week, e.g. Tuesdays and Thursdays: 2, 5, 2). Returned in the order it continues after the
 * last run; null if there's none (yet).
 */
function gapCycle(gaps) {
    const n = gaps.length;
    for (let k = 1; k < n; k += 1) {
        if (!gaps.every((gap, i) => i < k || gap === gaps[i - k])) {
            continue;
        }
        const days = gaps.slice(0, k).reduce((sum, gap) => sum + gap, 0);
        if (days > 0 && (n >= 2 * k || days % 7 === 0)) {
            return gaps.slice(n - k);
        }
    }
    return null;
}

/**
 * The next runs of an id that ran at least twice, within [from, to] and not ended before `today`:
 * [{ start, end, intervalDays, last: { start, end }, pattern? }].
 * - A repeating cycle of gaps (gapCycle: every 28 days, or Tuesdays and Thursdays) is continued after the last run,
 *   each run as long as the runs at the same place in the cycle usually are (median). A cycle of several gaps
 *   comes with `pattern: { days, weekdays }` (its length, the weekdays it starts on).
 * - Without one (yet): its usual rhythm, the median days between run starts and the median run length.
 * A forecast run never overlaps the next one.
 */
function forecastRuns(runs, { from, to, today }) {
    if (runs.length < 2) {
        return [];
    }
    const gaps = runs.slice(1).map((run, index) => run.start - runs[index].start);
    const lengths = runs.map((run) => run.end - run.start + 1);
    const last = runs[runs.length - 1];
    const cycle = gapCycle(gaps);
    let gapAt;
    let lengthAt;
    let intervalDays;
    let pattern = null;
    if (cycle) {
        const k = cycle.length;
        gapAt = (i) => cycle[i % k];
        // Per place in the cycle (counted so that the next run is place 0) the median length of the runs there.
        const slotLengths = Array.from({ length: k }, (_, slot) =>
            Math.round(median(lengths.filter((_, j) => (((j - (runs.length - k)) % k) + k) % k === slot))),
        );
        lengthAt = (i) => slotLengths[i % k];
        intervalDays = cycle.reduce((sum, gap) => sum + gap, 0);
        if (k > 1) {
            const weekdays = [...new Set(runs.slice(-k).map((run) => weekdayIndex(run.start)))].sort((a, b) => a - b);
            pattern = { days: intervalDays, weekdays: weekdays.map((index) => WEEKDAYS[index]) };
        }
    } else {
        const interval = Math.round(median(gaps));
        if (interval < 1) {
            return [];
        }
        const length = Math.round(median(lengths));
        gapAt = () => interval;
        lengthAt = () => length;
        intervalDays = interval;
    }
    const forecast = [];
    let start = last.start;
    for (let i = 0; ; i += 1) {
        start += gapAt(i);
        if (start > to) {
            break;
        }
        const end = start + Math.min(lengthAt(i), gapAt(i + 1)) - 1;
        if (start > last.end && end >= from && end >= today) {
            forecast.push({ start, end, intervalDays, last, ...(pattern ? { pattern } : {}) });
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

/**
 * The exact moments (ms timestamps) a run starts and ends: runs start and end at the game day's reset, so it starts
 * at 02:00 UTC on its first day and ends at 02:00 UTC after its last one.
 */
function runMoments(run) {
    return {
        start: dayDate(run.start).getTime() + GAME_DAY_START_MS,
        end: dayDate(run.end + 1).getTime() + GAME_DAY_START_MS,
    };
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
    runMoments,
};

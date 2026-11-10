/**
 * Everything about time in the game. Days are whole numbers (days since 1970-01-01), so time zones and daylight
 * saving can't shift them; "today" is the game day, which starts at 02:00 UTC (`gameDay`).
 * - the recorded schedule (`schedule` in pack_data.json: per id its runs as inclusive start/end dates) as day
 *   numbers (`scheduleRuns`), plus a simple forecast for ids that ran at least twice (`forecastRuns`); with `today`
 *   the runs of a proven pattern up to today count as runs;
 * - what can be recorded: the ids (`recordableIds`), the forecast runs on today that aren't recorded yet
 *   (`unrecordedToday`) and the usual length of an id's runs (`usualRunDays`);
 * - where an id's runs stand (`runStatus`) and the exact moments a run starts and ends (`runMoments`, `dayStartMs`);
 * - weekday offers (packs on sale on certain weekdays): where one stands in the game week (`weekdayOfferTiming`)
 *   and the runs of days it is on sale (`weekdayRuns`);
 * - event rotations (`event_rotations`: gameplay events running through a fixed list of slots on a fixed clock):
 *   the phase on now and the next (`rotationSlots`), every slot of a window (`rotationWindow`);
 * - the calendar helpers `dayDate`, `weekdayIndex` and `isoWeekNumber`.
 * Pure module: no clock of its own, callers pass `today` / `nowMs`.
 */

import { seasonalPassFamilies } from './pack-data.js';
import { median } from './stats.js';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const DAYS_PER_WEEK = 7;
const WEEK_MS = DAYS_PER_WEEK * DAY_MS;
// A proven pattern is only trusted this long after its last recorded run (8 weeks, or two rounds of a slower cycle);
// then it is a rough guess again.
const STALE_DAYS = 8 * DAYS_PER_WEEK;
// Monday first: weekly limits reset on Monday, so a weekday's index is its offset into the week.
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

/** Day number -> "2026-10-12" (the inverse of `dayNumber`). */
function dayText(day) {
    return dayDate(day).toISOString().slice(0, 10);
}

// The game's day starts (and ends) at 02:00 UTC, whatever the local time zone or daylight saving.
const GAME_DAY_START_MS = 2 * HOUR_MS;

/**
 * The game day a moment falls in: `{ day }`, its day number (the date it started on). 01:00 UTC on Oct 18 is still the
 * game day Oct 17.
 */
function gameDay(date) {
    return { day: Math.floor((date.getTime() - GAME_DAY_START_MS) / DAY_MS) };
}

/** Monday = 0 ... Sunday = 6. */
function weekdayIndex(day) {
    return (dayDate(day).getUTCDay() + 6) % 7;
}

/** The Monday of a day's week (a day number). */
function weekStart(day) {
    return day - weekdayIndex(day);
}

/** ISO week number of a day (the week's Thursday decides its year). */
function isoWeekNumber(day) {
    const thursday = weekStart(day) + 3;
    const year = dayDate(thursday).getUTCFullYear();
    return Math.floor((thursday - dayNumber(`${year}-01-01`)) / DAYS_PER_WEEK) + 1;
}

/** Whether a run (inclusive `start` / `end` day numbers) is on on this day. */
function runContains(run, day) {
    return run.start <= day && day <= run.end;
}

/**
 * id -> { kind, runs: [{ start, end }] } (inclusive day numbers, oldest first). kind: 'event', 'ingame' (events
 * with category "ingame_event"), 'alliance' (events with `calendar_group: "alliance"`), 'pass' (seasonal pass families) or 'track' (spend
 * reward tracks, and events with `calendar_group: "spend_rewards"`).
 * With `today` (a game day) the runs of a proven forecast that started by today are in too (`forecast: true`, with
 * what `forecastRuns` gives): a pattern that has held counts as running without being recorded. Without it: the
 * recorded runs only.
 */
function scheduleRuns(data, today) {
    const result = new Map();
    for (const [id, runs] of Object.entries(data.schedule || {})) {
        let kind = 'pass';
        if (data.events?.[id]) {
            const event = data.events[id];
            if (event.calendar_group === 'spend_rewards') {
                kind = 'track';
            } else if (event.calendar_group === 'alliance') {
                kind = 'alliance';
            } else {
                kind = event.category === 'ingame_event' ? 'ingame' : 'event';
            }
        } else if (data.spend_reward_tracks?.[id]) {
            kind = 'track';
        }
        const days = runs
            .map((run) => ({ start: dayNumber(run.start), end: dayNumber(run.end) }))
            .sort((a, b) => a.start - b.start);
        if (today !== undefined) {
            const proven = forecastRuns(days, { from: -Infinity, to: today, today }).filter((run) => run.proven);
            days.push(...proven.map((run) => ({ ...run, forecast: true })));
        }
        result.set(id, { kind, runs: days });
    }
    return result;
}

/** The ids that can be recorded, by kind: `{ events, seasonal_passes, spend_reward_tracks }` (Sets; passes by family). */
function recordableIds(data) {
    return {
        events: new Set(Object.keys(data.events || {})),
        seasonal_passes: new Set(seasonalPassFamilies(data.packages).keys()),
        spend_reward_tracks: new Set(Object.keys(data.spend_reward_tracks || {})),
    };
}

/**
 * The forecast runs that cover game day `today` without a recorded run on it: `[{ id, run, proven }]` (`run` is
 * `{ start, end }` in day numbers; `proven` false = a rough guess, e.g. a pattern gone stale). These are the runs worth
 * recording now.
 */
function unrecordedToday(data, today) {
    const result = [];
    for (const [id, { runs }] of scheduleRuns(data)) {
        if (runs.some((run) => runContains(run, today))) {
            continue;
        }
        const forecast = forecastRuns(runs, { from: today, to: today, today }).find((run) => runContains(run, today));
        if (forecast) {
            const { start, end, proven } = forecast;
            result.push({ id, run: { start, end }, proven });
        }
    }
    return result;
}

/** How many days the runs of `id` usually last (the median of the recorded ones), or null if none is recorded. */
function usualRunDays(data, id) {
    const runs = data.schedule?.[id] || [];
    const lengths = runs.map((run) => dayNumber(run.end) - dayNumber(run.start) + 1);
    return lengths.length === 0 ? null : Math.round(median(lengths));
}

/**
 * Ids (events, pass families, tracks) with a run on game day `today`: recorded, or a proven pattern.
 */
function runningToday(data, today) {
    return new Set(
        [...scheduleRuns(data, today)]
            .filter(([, { runs }]) => runs.some((run) => runContains(run, today)))
            .map(([id]) => id),
    );
}

/**
 * What the calendar selects on game day `today`: `{ activeEvents, seasonalPasses }`. Gameplay events (no packs, no
 * shop) aren't selectable; seasonal passes by package family.
 */
function calendarSelection(data, today) {
    const running = runningToday(data, today);
    const passFamilies = seasonalPassFamilies(data.packages).keys();
    return {
        activeEvents: Object.entries(data.events || {})
            .filter(([id, event]) => event.category !== 'ingame_event' && running.has(id))
            .map(([id]) => id),
        seasonalPasses: [...passFamilies].filter((id) => running.has(id)),
    };
}

/**
 * What runs on game day `today` and what starts within the next `soonDays` days: `{ running, soon }`, each a list of
 * `{ id, kind, run, forecast }` (the run is `{ start, end }`, `forecast` true for a run of a proven pattern that isn't
 * recorded). Forecasts only where the pattern has proven itself; a guess would be noise in a list of what's next.
 */
function listRuns(data, today, soonDays) {
    const running = [];
    const soon = [];
    for (const [id, { kind, runs }] of scheduleRuns(data, today)) {
        const current = runs.find((run) => runContains(run, today));
        if (current) {
            running.push({ id, kind, run: current, forecast: Boolean(current.forecast) });
        }
        const upcoming = [
            ...runs.filter((run) => run.start > today),
            ...forecastRuns(runs, { from: today + 1, to: today + soonDays, today })
                .filter((run) => run.proven)
                .map((run) => ({ ...run, forecast: true })),
        ].filter((run) => run.start > today && run.start <= today + soonDays);
        for (const run of upcoming) {
            soon.push({ id, kind, run, forecast: Boolean(run.forecast) });
        }
    }
    return { running, soon };
}

/**
 * The schedule between game days `from` and `to` as timeline bars: per id with a run in that window
 * `{ id, kind, bars }`, the bars `{ start, end, past, forecast?, ... }` oldest first: the recorded runs (`past`: ended
 * before `today`, the proven forecast's too) and the forecast to come (forecastRuns).
 */
function scheduleBars(data, today, from, to) {
    const rows = [];
    for (const [id, { kind, runs }] of scheduleRuns(data, today)) {
        const bars = [
            ...runs.map((run) => ({ ...run, past: run.end < today })),
            ...forecastRuns(runs, { from, to, today }).map((run) => ({ ...run, forecast: true })),
        ].filter((bar) => bar.end >= from && bar.start <= to);
        if (bars.length > 0) {
            rows.push({ id, kind, bars });
        }
    }
    return rows;
}

/**
 * Where a weekday offer (on sale on `availableDays`, any day if none) stands in the game week of game day `today`
 * (Monday to Sunday): `{ state, days }`: 'today' (on sale today), 'upcoming' (`days` until its next weekday this
 * week) or 'past' (all its weekdays were earlier this week).
 */
function weekdayOfferTiming(availableDays, today) {
    const index = weekdayIndex(today);
    const wanted = (availableDays || []).map((name) => WEEKDAYS.indexOf(name)).filter((day) => day >= 0);
    if (wanted.length === 0 || wanted.includes(index)) {
        return { state: 'today', days: 0 };
    }
    const ahead = wanted.filter((day) => day > index);
    return ahead.length > 0 ? { state: 'upcoming', days: Math.min(...ahead) - index } : { state: 'past', days: 0 };
}

/**
 * The days in [from, to] on one of the given weekdays ("monday", ...). Consecutive days are merged into one run
 * unless `merge` is false (a daily-limit offer: each day is its own sale, the purchase limit resets in between).
 */
function weekdayRuns(availableDays, from, to, { merge = true } = {}) {
    const wanted = new Set((availableDays || []).map((name) => WEEKDAYS.indexOf(name)));
    const runs = [];
    for (let day = from; day <= to; day += 1) {
        if (wanted.has(weekdayIndex(day))) {
            const last = runs[runs.length - 1];
            if (merge && last && last.end === day - 1) {
                last.end = day;
            } else {
                runs.push({ start: day, end: day });
            }
        }
    }
    return runs;
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
        if (days > 0 && (n >= 2 * k || days % DAYS_PER_WEEK === 0)) {
            return gaps.slice(n - k);
        }
    }
    return null;
}

/**
 * The next runs of an id that was recorded at least twice, within [from, to]:
 * [{ start, end, intervalDays, last: { start, end }, proven, stale, runCount, pattern? }].
 * - A repeating cycle of gaps (gapCycle: every 28 days, or Tuesdays and Thursdays) is continued after the last run,
 *   each run as long as the runs at the same place in the cycle usually are (median); `proven`. A cycle of several
 *   gaps comes with `pattern: { days, weekdays }` (its length, the weekdays it starts on).
 * - Without one (yet): its usual rhythm, the median days between run starts and the median run length; a rough guess
 *   (`proven` false, `runCount` = the recorded runs it rests on).
 * - A cycle whose last recorded run ended more than STALE_DAYS (or two rounds of the cycle, if that is longer) before
 *   `today` is no longer trusted: its runs are a rough guess too (`stale`), until a new run is recorded.
 * Only recorded runs count (entries of `runs` with `forecast` are skipped, so the forecast of `scheduleRuns` can be
 * passed in), and only runs after the last of all given ones are returned. A run that isn't proven is only given if
 * it didn't end before `today`. A forecast run never overlaps the next one.
 */
function forecastRuns(allRuns, { from, to, today }) {
    const runs = allRuns.filter((run) => !run.forecast);
    if (runs.length < 2) {
        return [];
    }
    const gaps = runs.slice(1).map((run, index) => run.start - runs[index].start);
    const lengths = runs.map((run) => run.end - run.start + 1);
    const last = runs[runs.length - 1];
    const lastEnd = Math.max(...allRuns.map((run) => run.end));
    const cycle = gapCycle(gaps);
    const cycleDays = cycle ? cycle.reduce((sum, gap) => sum + gap, 0) : 0;
    const proven = Boolean(cycle) && today - last.end <= Math.max(STALE_DAYS, 2 * cycleDays);
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
        intervalDays = cycleDays;
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
        if (start > lastEnd && end >= from && (proven || end >= today)) {
            forecast.push({
                start,
                end,
                intervalDays,
                last,
                proven,
                stale: Boolean(cycle) && !proven,
                runCount: runs.length,
                ...(pattern ? { pattern } : {}),
            });
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
    const running = runs.find((run) => runContains(run, today));
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
 * The next run to come after `today`: the recorded (or proven) one that starts first, else the first forecast run
 * within `horizon` days (see forecastRuns); null if there is none.
 */
function nextRun(runs, today, horizon = 366) {
    const upcoming = runs.filter((run) => run.start > today).sort((a, b) => a.start - b.start)[0];
    return upcoming ?? forecastRuns(runs, { from: today, to: today + horizon, today })[0] ?? null;
}

/**
 * The run a plan for schedule id `id` is about (a mine's inputs): the one on now (`days` left, today included), else
 * the next one (all its days; recorded or forecast). `{ state: 'running' | 'next', start, days }`, or null without a
 * schedule.
 */
function planningRun(data, id, today) {
    const runs = scheduleRuns(data, today).get(id)?.runs || [];
    const status = runStatus(runs, today);
    if (status?.state === 'running') {
        return { state: 'running', start: status.run.start, days: status.days + 1 };
    }
    const next = nextRun(runs, today);
    return next ? { state: 'next', start: next.start, days: next.end - next.start + 1 } : null;
}

/** The moment (ms) a game day starts: its reset, 02:00 UTC on its date (the previous day ends then). */
function dayStartMs(day) {
    return dayDate(day).getTime() + GAME_DAY_START_MS;
}

/**
 * The exact moments (ms timestamps) a run starts and ends: runs start and end at the game day's reset, so it starts
 * at 02:00 UTC on its first day and ends at 02:00 UTC after its last one.
 */
function runMoments(run) {
    return { start: dayStartMs(run.start), end: dayStartMs(run.end + 1) };
}

/** The moment (ms) the rotation's week that `ms` falls in started: the daily reset (02:00 UTC) of `week_starts`. */
function rotationWeekStart(rotation, ms) {
    const today = gameDay(new Date(ms)).day;
    const weekStartDay =
        today - ((weekdayIndex(today) - WEEKDAYS.indexOf(rotation.week_starts) + DAYS_PER_WEEK) % DAYS_PER_WEEK);
    return dayStartMs(weekStartDay);
}

/** Slot `k` of the week that started at `weekStartMs`: `{ slot, phaseId, phase, start, end }` (ms). */
function rotationSlot(rotation, weekStartMs, k) {
    const phaseId = rotation.week[k];
    const start = weekStartMs + k * rotation.hours * HOUR_MS;
    const phase = rotation.phases.find((candidate) => candidate.id === phaseId);
    return { slot: k, phaseId, phase, start, end: start + rotation.hours * HOUR_MS };
}

/**
 * Where an event rotation (`event_rotations` in pack_data.json: a list of slots of `hours` each, `week`, naming the
 * phase of every slot from the start of the week) stands at `nowMs`: `{ current, next }`, each
 * `{ slot, phaseId, phase, start, end }` (ms). The week starts at the daily reset (02:00 UTC) of `week_starts` and the
 * same week repeats, so the slot after the week's last one is slot 0 of the next week. The list is the sequence as the
 * game runs it, not a loop (Survival Battle: a round of five, Territory > Heroes, then seven rounds of five).
 */
function rotationSlots(rotation, nowMs) {
    const weekStart = rotationWeekStart(rotation, nowMs);
    const k = Math.floor((nowMs - weekStart) / (rotation.hours * HOUR_MS));
    return {
        current: rotationSlot(rotation, weekStart, k),
        next:
            k + 1 < rotation.week.length
                ? rotationSlot(rotation, weekStart, k + 1)
                : rotationSlot(rotation, weekStart + WEEK_MS, 0),
    };
}

/**
 * The rotation's current slot if it started within the last `graceMs` of `nowMs` (a round has just begun), else null.
 */
function freshSlot(rotation, nowMs, graceMs) {
    const { current } = rotationSlots(rotation, nowMs);
    return nowMs - current.start <= graceMs ? current : null;
}

/** Every slot of the rotation that overlaps [fromMs, toMs), in order (a slot cut by the window is included whole). */
function rotationWindow(rotation, fromMs, toMs) {
    const slots = [];
    for (let weekStart = rotationWeekStart(rotation, fromMs); weekStart < toMs; weekStart += WEEK_MS) {
        for (let k = 0; k < rotation.week.length; k += 1) {
            const slot = rotationSlot(rotation, weekStart, k);
            if (slot.end > fromMs && slot.start < toMs) {
                slots.push(slot);
            }
        }
    }
    return slots;
}

export {
    DAYS_PER_WEEK,
    DAY_MS,
    HOUR_MS,
    WEEKDAYS,
    dayDate,
    dayNumber,
    dayText,
    gameDay,
    dayStartMs,
    weekdayIndex,
    weekStart,
    isoWeekNumber,
    runContains,
    runningToday,
    recordableIds,
    unrecordedToday,
    usualRunDays,
    calendarSelection,
    listRuns,
    scheduleBars,
    scheduleRuns,
    forecastRuns,
    weekdayRuns,
    weekdayOfferTiming,
    runStatus,
    nextRun,
    planningRun,
    runMoments,
    rotationSlots,
    freshSlot,
    rotationWindow,
};

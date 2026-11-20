/**
 * The Kingdom War (`kingdom_war` in events.json), a cycle that repeats forever: its weeks in order from
 * `cycle_start` (a Monday), each a war week (Week 1, Week 2, Week 3: Finals) or `null` for a break week, and the Royal
 * City Scramble, which runs every Saturday of a war week (none in the break), and Origin of the Curse, which runs in
 * every break week.
 * - the periods (`warPeriods`): the war weeks, each from its Monday's reset through its first `days` game days (until
 *   the end of Saturday), and the breaks. A break is the time between two war weeks that is longer than the one Sunday
 *   between weeks of the same stretch, so it takes the Sundays on both sides along; that plain Sunday is no period.
 * - where the war stands (`warStatus`): the period on now and the next war week;
 * - the scramble's slots (`scrambleSlots`) and where it stands (`scrambleStatus`), in ms;
 * - Origin of the Curse's runs (`curseRuns`), each a row of phase segments from its timeline, and where it stands
 *   (`curseStatus`: the segment on now and the next), in ms.
 * Days are game days (day numbers, see core/schedule.js); `start_hour` and a timeline's `time` count from the day's
 * reset, which is 00:00 server time. Pure module: callers pass `today` / `nowMs`.
 */
import { DAYS_PER_WEEK, DAY_MS, HOUR_MS, WEEKDAYS, dayNumber, dayStartMs, gameDay } from './schedule.js';

// How far (in cycles) the status looks ahead for the next war week.
const LOOKAHEAD_CYCLES = 2;
// The window of `scrambleStatus`: a slot that began up to a day ago, and the next one within two weeks and a bit (the
// break week has none).
const SCRAMBLE_BEHIND_MS = 24 * HOUR_MS;
const SCRAMBLE_AHEAD_MS = 15 * 24 * HOUR_MS;

/** The weeks (`{ week, start }`: a war week or null for a break week, its Monday as a game day) of the cycles around [from, to], oldest first. */
function cycleWeeks(war, from, to) {
    const cycleDays = war.weeks.length * DAYS_PER_WEEK;
    const first = dayNumber(war.cycle_start);
    const fromCycle = Math.floor((from - first) / cycleDays) - 1;
    const toCycle = Math.floor((to - first) / cycleDays) + 1;
    const weeks = [];
    for (let cycle = fromCycle; cycle <= toCycle; cycle += 1) {
        war.weeks.forEach((week, index) => {
            weeks.push({ week, start: first + cycle * cycleDays + index * DAYS_PER_WEEK });
        });
    }
    return weeks;
}

/** The war weeks (`{ kind: 'week', week, start, end }`, game days) of the cycles around [from, to], oldest first. */
function warWeeks(war, from, to) {
    return cycleWeeks(war, from, to)
        .filter(({ week }) => week)
        .map(({ week, start }) => ({ kind: 'week', week, start, end: start + war.days - 1 }));
}

/**
 * The periods that overlap the game days [from, to], oldest first: `{ kind: 'week', week, start, end }` for a war
 * week (`week` is its `{ id, name }`) and `{ kind: 'break', start, end }` for a break (inclusive game days).
 */
function warPeriods(war, from, to) {
    const weeks = warWeeks(war, from, to);
    const periods = [];
    weeks.forEach((week, index) => {
        periods.push(week);
        const next = weeks[index + 1];
        // More than the one day off between two weeks of a stretch (a Sunday): the break.
        if (next && next.start - week.end - 1 > DAYS_PER_WEEK - war.days) {
            periods.push({ kind: 'break', start: week.end + 1, end: next.start - 1 });
        }
    });
    return periods.filter((period) => period.end >= from && period.start <= to);
}

/**
 * Where the war stands on game day `today`: `{ current, next }`. `current` is the war week or break on now (null on
 * the Sunday between two war weeks), `next` the next war week that starts after today (null if none within the look-ahead).
 */
function warStatus(war, today) {
    const periods = warPeriods(war, today, today + LOOKAHEAD_CYCLES * war.weeks.length * DAYS_PER_WEEK);
    return {
        current: periods.find((period) => period.start <= today && today <= period.end) || null,
        next: periods.find((period) => period.kind === 'week' && period.start > today) || null,
    };
}

/** The scramble's slots that overlap [fromMs, toMs): `{ start, end }` (ms), oldest first. None in a break week. */
function scrambleSlots(war, fromMs, toMs) {
    const { weekday, start_hour: startHour, hours } = war.royal_city_scramble;
    const wanted = WEEKDAYS.indexOf(weekday);
    const slots = [];
    for (const { week, start: monday } of cycleWeeks(war, gameDay(new Date(fromMs)).day, gameDay(new Date(toMs)).day)) {
        if (week) {
            const start = dayStartMs(monday + wanted) + startHour * HOUR_MS;
            const end = start + hours * HOUR_MS;
            if (end > fromMs && start < toMs) {
                slots.push({ start, end });
            }
        }
    }
    return slots;
}

/** Where the scramble stands at `nowMs`: `{ current, next }` (slots; `current` is null when it isn't on). */
function scrambleStatus(war, nowMs) {
    const slots = scrambleSlots(war, nowMs - SCRAMBLE_BEHIND_MS, nowMs + SCRAMBLE_AHEAD_MS);
    return {
        current: slots.find((slot) => slot.start <= nowMs && nowMs < slot.end) || null,
        next: slots.find((slot) => slot.start > nowMs) || null,
    };
}

/** "13:30" -> ms after the day's reset. */
function clockMs(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * HOUR_MS + minutes * (HOUR_MS / 60);
}

/**
 * Origin of the Curse's runs that overlap [fromMs, toMs), oldest first: one in every break week, from its first
 * timeline entry to the end of the break week (or a `null` entry). `{ start, end, segments }` (ms) with the segments
 * `{ phase, start, end }` (`phase` is the `{ id, name }` of `phases`): each lasts until the next entry.
 */
function curseRuns(war, fromMs, toMs) {
    const curse = war.origin_of_the_curse;
    const phases = new Map(curse.phases.map((phase) => [phase.id, phase]));
    const runs = [];
    const weeks = cycleWeeks(war, gameDay(new Date(fromMs)).day, gameDay(new Date(toMs)).day);
    for (const { week, start } of weeks) {
        if (!week) {
            const at = (entry) => dayStartMs(start + WEEKDAYS.indexOf(entry.weekday)) + clockMs(entry.time);
            const weekEnd = dayStartMs(start + DAYS_PER_WEEK);
            const segments = curse.timeline.flatMap((entry, index) =>
                entry.phase
                    ? [
                          {
                              phase: phases.get(entry.phase),
                              start: at(entry),
                              end: index + 1 < curse.timeline.length ? at(curse.timeline[index + 1]) : weekEnd,
                          },
                      ]
                    : [],
            );
            const run = { start: segments[0].start, end: segments[segments.length - 1].end, segments };
            if (run.end > fromMs && run.start < toMs) {
                runs.push(run);
            }
        }
    }
    return runs;
}

/** Where Origin of the Curse stands at `nowMs`: `{ current, next }` (segments; `current` is null between and outside its runs). */
function curseStatus(war, nowMs) {
    const cycleMs = war.weeks.length * DAYS_PER_WEEK * DAY_MS;
    const segments = curseRuns(war, nowMs, nowMs + cycleMs).flatMap((run) => run.segments);
    return {
        current: segments.find((segment) => segment.start <= nowMs && nowMs < segment.end) || null,
        next: segments.find((segment) => segment.start > nowMs) || null,
    };
}

export { curseRuns, curseStatus, scrambleSlots, scrambleStatus, warPeriods, warStatus };

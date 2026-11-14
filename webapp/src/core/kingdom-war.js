/**
 * The Kingdom War (`kingdom_war` in events.json), a cycle that repeats forever: its weeks in order from
 * `cycle_start` (a Monday), each a war week (Week 1, Week 2, Week 3: Finals) or `null` for a break week, and the Royal
 * City Scramble, which runs every Saturday of it, the break included.
 * - the periods (`warPeriods`): the war weeks, each from its Monday's reset through its first `days` game days (until
 *   the end of Saturday), and the breaks. A break is the time between two war weeks that is longer than the one Sunday
 *   between weeks of the same stretch, so it takes the Sundays on both sides along; that plain Sunday is no period.
 * - where the war stands (`warStatus`): the period on now and the next war week;
 * - the scramble's slots (`scrambleSlots`) and where it stands (`scrambleStatus`), in ms.
 * Days are game days (day numbers, see core/schedule.js); `start_hour` counts from the day's reset, which is 00:00
 * server time. Pure module: callers pass `today` / `nowMs`.
 */
import { DAYS_PER_WEEK, HOUR_MS, WEEKDAYS, dayNumber, dayStartMs, gameDay, weekdayIndex } from './schedule.js';

// How far (in cycles) the status looks ahead for the next war week.
const LOOKAHEAD_CYCLES = 2;
// The window of `scrambleStatus`: a slot that began up to a day ago, and the next one within a week and a bit.
const SCRAMBLE_BEHIND_MS = 24 * HOUR_MS;
const SCRAMBLE_AHEAD_MS = 8 * 24 * HOUR_MS;

/** The war weeks (`{ kind: 'week', week, start, end }`, game days) of the cycles around [from, to], oldest first. */
function warWeeks(war, from, to) {
    const cycleDays = war.weeks.length * DAYS_PER_WEEK;
    const first = dayNumber(war.cycle_start);
    const fromCycle = Math.floor((from - first) / cycleDays) - 1;
    const toCycle = Math.floor((to - first) / cycleDays) + 1;
    const weeks = [];
    for (let cycle = fromCycle; cycle <= toCycle; cycle += 1) {
        war.weeks.forEach((week, index) => {
            if (week) {
                const start = first + cycle * cycleDays + index * DAYS_PER_WEEK;
                weeks.push({ kind: 'week', week, start, end: start + war.days - 1 });
            }
        });
    }
    return weeks;
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

/** The scramble's slots that overlap [fromMs, toMs): `{ start, end }` (ms), oldest first. */
function scrambleSlots(war, fromMs, toMs) {
    const { weekday, start_hour: startHour, hours } = war.royal_city_scramble;
    const wanted = WEEKDAYS.indexOf(weekday);
    const slots = [];
    for (let day = gameDay(new Date(fromMs)).day - 1; day <= gameDay(new Date(toMs)).day; day += 1) {
        if (weekdayIndex(day) === wanted) {
            const start = dayStartMs(day) + startHour * HOUR_MS;
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

export { scrambleSlots, scrambleStatus, warPeriods, warStatus };

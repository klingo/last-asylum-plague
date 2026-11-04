/**
 * Skipping a recommended pack (the Deal Ranking's "Skip"): the weekly plan is solved again without it, so the spend is
 * filled up with other packs. A skip is remembered as a package id and the first game day it no longer applies:
 * - it lasts until the earlier of the end of the game week (the next Monday's reset) and the end of the current run
 *   of the pack's event or seasonal pass (from the schedule), `skipUntilDay`;
 * - a higher tier of a ladder requires the lower one, so skipping a tier skips every tier above it too, `expandSkips`.
 */
import { packageFamilyId } from './pack-data.js';
import { scheduleRuns, weekdayIndex } from './schedule.js';

const DAYS_PER_WEEK = 7;
// A ladder never gets this long; stops a (broken) requires cycle.
const MAX_LADDER = 20;

/**
 * The first game day a skip made on `today` no longer applies: the earlier of the next weekly reset and the day after
 * the end of the run (of the package's event, or of its seasonal pass family) that includes today. Without a known
 * run, the week's end.
 */
function skipUntilDay(id, pkg, today, data) {
    const weekEnd = today - weekdayIndex(today) + DAYS_PER_WEEK;
    const scheduleId = pkg.event_id || (pkg.seasonal ? packageFamilyId(id, pkg) : null);
    const runs = scheduleId ? scheduleRuns(data, today).get(scheduleId)?.runs : null;
    const run = runs?.find((candidate) => candidate.start <= today && today <= candidate.end);
    return run ? Math.min(weekEnd, run.end + 1) : weekEnd;
}

/** The package ids whose skip (`{ <id>: untilDay }`) still applies on game day `today`. */
function activeSkips(skips, today) {
    return Object.entries(skips || {})
        .filter(([, until]) => Number.isFinite(until) && until > today)
        .map(([id]) => id);
}

/**
 * Every package a skip takes out of the plan: the skipped ones and every package whose `requires` chain reaches one
 * (tier 2 requires tier 1, ...): Map package id -> the skipped package that causes it (the id itself for a package
 * skipped by name). Skipping tier 2 leaves tier 1 alone.
 */
function expandSkips(ids, packages) {
    const skipped = new Set(ids);
    const causes = new Map();
    for (const id of Object.keys(packages)) {
        let current = id;
        for (let depth = 0; current && depth < MAX_LADDER; depth += 1) {
            if (skipped.has(current)) {
                causes.set(id, current);
                break;
            }
            current = packages[current]?.requires;
        }
    }
    return causes;
}

export { skipUntilDay, activeSkips, expandSkips };

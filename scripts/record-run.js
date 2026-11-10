import { execSync } from 'node:child_process';
import { normalizePackData } from '../webapp/src/core/pack-data.js';
import {
    dayDate,
    dayNumber,
    dayText,
    forecastRuns,
    gameDay,
    recordableIds,
    scheduleRuns,
} from '../webapp/src/core/schedule.js';
import { ROOT, PACK_DATA_PATH, readJson, writeJson, splitArgs, isMain } from './lib/data-files.js';
import { sortPackData } from './sort-pack-data.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_PATTERN = /^\d+$/;
// Runs kept per id: plenty to prove a pattern, and a changed rhythm can prove itself again once the old runs are gone.
const MAX_RUNS = 12;

/**
 * Records when events (incl. in-game events), seasonal passes and spend reward tracks run, in the `schedule`
 * section of data/pack_data.json: per id a list of runs `{ start, end }` (inclusive dates). The Home page draws
 * them as a timeline and forecasts the next runs from them.
 *
 * Usage: npm run record-run -- <ids...> [START] <DAYS> | --show [ids...] | --help
 *   (no ids / --help: prints the usage with examples and the valid ids)
 *   ids    event ids, seasonal pass family ids and/or spend reward track ids (classified automatically)
 *   START  first day, YYYY-MM-DD (default: today, the game day: it starts at 02:00 UTC)
 *   DAYS   how many days it runs, the start day included (end = START + DAYS - 1)
 *   --show print the recorded runs (of the given ids, or all; nothing is written), and the proven patterns that are
 *          no longer trusted (no run recorded for 8 weeks, or two rounds of a slower pattern; they count again once
 *          their runs since then are recorded)
 * A run with the same start as a recorded one replaces it (to correct its length); other overlaps are refused.
 * A new run that lands on the id's proven pattern also records the runs of the pattern missed in between. Only the last
 * 12 runs of an id are kept (git history has the rest).
 * The record-run workflow (.github/workflows/record-run.yml, started from Settings > Admin) runs it too.
 */
function main() {
    const args = process.argv.slice(2);
    const data = readJson(PACK_DATA_PATH);
    const kinds = recordableIds(normalizePackData(data));
    const { flags } = splitArgs(args);
    const { ids, dates, counts } = parseRecordArgs(args);

    if (flags.has('--show')) {
        printSchedule(data.schedule || {}, ids);
        printMissed(data, ids);
        return;
    }
    // Nothing to record (or --help): show how to use it.
    if (ids.length === 0 || flags.has('--help')) {
        printUsage(kinds, data.events || {});
        return;
    }

    const unknown = ids.filter((id) => !Object.values(kinds).some((set) => set.has(id)));
    if (unknown.length > 0) {
        fail(
            [
                `Unknown id(s): ${unknown.join(', ')}. Nothing was written.`,
                `  Events: ${[...kinds.events].join(', ')}`,
                `  Seasonal passes: ${[...kinds.seasonal_passes].join(', ')}`,
                `  Spend reward tracks: ${[...kinds.spend_reward_tracks].join(', ')}`,
            ].join('\n'),
        );
    }
    if (dates.length > 1) {
        fail(`One start date per call (got ${dates.join(', ')}). Record runs with other dates separately.`);
    }
    if (counts.length !== 1 || Number(counts[0]) < 1) {
        fail('Give the number of days it runs (1 or more), e.g. npm run record-run -- strange_bazaar 2026-10-12 7');
    }
    const start = dates[0] || gameToday();
    if (!isValidDate(start)) {
        fail(`Invalid date "${start}". Use YYYY-MM-DD.`);
    }
    const end = addDays(start, Number(counts[0]) - 1);

    const result = recordRun(data, ids, start, end);
    if (result.error) {
        fail(result.error);
    }
    writeJson(PACK_DATA_PATH, sortPackData(data));
    // Same tidy-up as the commit hook: prettier formatting.
    execSync('npx prettier --write data/pack_data.json', { cwd: ROOT, stdio: 'ignore' });

    console.log(`Recorded (${daysText(start, end)}):`);
    console.log(result.changes.join('\n'));
}

/** The command line sorted into `{ ids, dates, counts }`: dates are YYYY-MM-DD, counts whole numbers, the rest ids. */
function parseRecordArgs(args) {
    const { positional } = splitArgs(args);
    return {
        dates: positional.filter((arg) => DATE_PATTERN.test(arg)),
        counts: positional.filter((arg) => DAYS_PATTERN.test(arg)),
        ids: positional.filter((arg) => !DATE_PATTERN.test(arg) && !DAYS_PATTERN.test(arg)),
    };
}

/**
 * Records the run `start`..`end` (YYYY-MM-DD, inclusive) for every id in `data.schedule`. A run with the same start
 * replaces the recorded one (its length is corrected); another overlap is refused, and nothing is recorded then.
 * A new run that lands on the id's proven pattern also records the pattern's runs missed in between (`missedRuns`).
 * Only the last MAX_RUNS runs of an id are kept. Returns `{ changes }` (lines to print) or `{ error }`.
 */
function recordRun(data, ids, start, end) {
    const staged = {};
    const changes = [];
    for (const id of ids) {
        const runs = (data.schedule?.[id] || [])
            .map((run) => ({ ...run }))
            .sort((a, b) => a.start.localeCompare(b.start));
        const same = runs.find((run) => run.start === start);
        const overlap = runs.find((run) => run !== same && run.start <= end && start <= run.end);
        if (overlap) {
            return {
                error:
                    `${id}: ${start}..${end} overlaps its recorded run ${overlap.start}..${overlap.end}. Nothing was written. ` +
                    'Fix it in data/pack_data.json ("schedule") if that run is wrong.',
            };
        }
        if (same) {
            changes.push(`  ${id}: ${same.start}..${same.end} -> ${start}..${end} (updated)`);
            same.end = end;
        } else {
            for (const missed of missedRuns(runs, start)) {
                changes.push(`  ${id}: ${missed.start}..${missed.end} (filled in from the pattern)`);
                runs.push(missed);
            }
            changes.push(`  ${id}: ${start}..${end}`);
            runs.push({ start, end });
        }
        runs.sort((a, b) => a.start.localeCompare(b.start));
        for (const dropped of runs.splice(0, Math.max(0, runs.length - MAX_RUNS))) {
            changes.push(`  ${id}: ${dropped.start}..${dropped.end} dropped (keeps the last ${MAX_RUNS})`);
        }
        staged[id] = runs;
    }
    data.schedule = { ...data.schedule, ...staged };
    return { changes };
}

/**
 * The runs (`{ start, end }` dates) the proven pattern of `runs` (sorted) has between its last run and a new one
 * starting on `start`, if the new run lands exactly on the pattern; else none. The pattern counts as proven as of
 * `start`, so after a pause past its trust window (see forecastRuns) nothing is invented.
 */
function missedRuns(runs, start) {
    const days = runs.map((run) => ({ start: dayNumber(run.start), end: dayNumber(run.end) }));
    const first = dayNumber(start);
    if (days.length === 0 || first <= days[days.length - 1].end) {
        return [];
    }
    const forecast = forecastRuns(days, { from: days[days.length - 1].end + 1, to: first, today: first }).filter(
        (run) => run.proven,
    );
    const landing = forecast.findIndex((run) => run.start === first);
    return forecast.slice(0, Math.max(landing, 0)).map((run) => ({ start: dayText(run.start), end: dayText(run.end) }));
}

/** Today's game day (it starts at 02:00 UTC, so before 04:00 CEST it's still yesterday) as YYYY-MM-DD. */
function gameToday() {
    return dayText(gameDay(new Date()).day);
}

/** Whether `text` is a real calendar date written YYYY-MM-DD (not 2026-02-30). */
function isValidDate(text) {
    return DATE_PATTERN.test(text) && dayText(dayNumber(text)) === text;
}

/** The date `days` after `text` (YYYY-MM-DD). */
function addDays(text, days) {
    return dayText(dayNumber(text) + days);
}

/** "Mon 2026-10-12 .. Sun 2026-10-18, 7 days" */
function daysText(start, end) {
    const weekday = (text) => dayDate(dayNumber(text)).toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' });
    const days = dayNumber(end) - dayNumber(start) + 1;
    return `${weekday(start)} ${start} .. ${weekday(end)} ${end}, ${days} day${days === 1 ? '' : 's'}`;
}

/** Usage with examples and every id that can be recorded. */
function printUsage(kinds, events) {
    const ingame = [...kinds.events].filter((id) => events[id]?.category === 'ingame_event');
    const shoppable = [...kinds.events].filter((id) => events[id]?.category !== 'ingame_event');
    const lines = [
        'Records when events, seasonal passes and spend reward tracks run (data/pack_data.json "schedule").',
        '',
        'Usage: npm run record-run -- <ids...> [START] <DAYS>   START = first day (YYYY-MM-DD, default: today),',
        '                                                       DAYS = how long it runs, the start day included',
        '       npm run record-run -- --show [ids...]',
        '',
        'Examples:',
        '  npm run record-run -- strange_bazaar 2026-10-12 7                 # Mon 12 Oct to Sun 18 Oct',
        '  npm run record-run -- claires_inner_demon 2026-10-12 2            # a 2-day event',
        '  npm run record-run -- tempered_arms 2026-10-12 14                 # a 2-week pass',
        '  npm run record-run -- recluse_merchant ancient_recipe_gearstone 7 # several ids, starting today',
        '  npm run record-run -- strange_bazaar 2026-10-12 9                 # same start again: corrects the length',
        '  npm run record-run -- --show strange_bazaar                       # list recorded runs',
        '',
        `Today (game day): ${daysText(gameToday(), gameToday())}.`,
        '',
        'Ids you can record:',
        `  Events:               ${shoppable.join(', ')}`,
        `  In-game events:       ${ingame.join(', ') || '-'}`,
        `  Seasonal passes:      ${[...kinds.seasonal_passes].join(', ')}`,
        `  Spend reward tracks:  ${[...kinds.spend_reward_tracks].join(', ')}`,
    ];
    console.log(lines.join('\n'));
}

function printSchedule(schedule, ids) {
    const shown = ids.length > 0 ? ids : Object.keys(schedule).sort();
    if (shown.length === 0) {
        console.log('Nothing recorded yet.');
        return;
    }
    for (const id of shown) {
        const runs = schedule[id] || [];
        console.log(`${id}${runs.length === 0 ? ': -' : ''}`);
        for (const run of runs) {
            console.log(`  ${daysText(run.start, run.end)}`);
        }
    }
}

/**
 * Ids with a repeating pattern (a forecast the Calendar trusts as runs) that is no longer trusted (`stale`, see
 * forecastRuns: no run recorded for 8 weeks, or two rounds of a slower pattern): it counts again once its runs since
 * then are recorded.
 */
function printMissed(data, ids) {
    const today = gameDay(new Date()).day;
    const stale = [];
    for (const [id, { runs }] of scheduleRuns(data)) {
        if (ids.length > 0 && !ids.includes(id)) {
            continue;
        }
        if (forecastRuns(runs, { from: 0, to: today + 365, today }).some((run) => run.stale)) {
            const last = runs[runs.length - 1];
            stale.push(`  ${id}: last recorded ${daysText(dayText(last.start), dayText(last.end))}`);
        }
    }
    console.log(
        stale.length > 0
            ? `\nProven patterns no longer trusted (record their runs since then):\n${stale.join('\n')}`
            : '\nEvery proven pattern is still trusted.',
    );
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

export { addDays, daysText, isValidDate, parseRecordArgs, recordRun };

if (isMain(import.meta)) {
    main();
}

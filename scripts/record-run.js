import { execSync } from 'node:child_process';
import { dayDate, dayNumber, forecastRuns, gameDay, scheduleRuns } from '../webapp/src/core/schedule.js';
import { ROOT, PACK_DATA_PATH, readJson, writeJson, splitArgs, isMain } from './lib/data-files.js';
import { sortPackData } from './sort-pack-data.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_PATTERN = /^\d+$/;

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
 *   --show print the recorded runs (of the given ids, or all; nothing is written), and the proven patterns whose
 *          last recorded run is over 8 weeks old (they no longer count until you record their latest run)
 * A run with the same start as a recorded one replaces it (to correct its length); other overlaps are refused.
 */
function main() {
    const args = process.argv.slice(2);
    const data = readJson(PACK_DATA_PATH);
    const kinds = recordableIds(data);
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

/** The ids that can be recorded, by kind: `{ events, seasonal_passes, spend_reward_tracks }` (Sets). */
function recordableIds(data) {
    return {
        events: new Set(Object.keys(data.events || {})),
        seasonal_passes: new Set(
            Object.entries(data.packages || {})
                .filter(([, pkg]) => pkg.seasonal)
                .map(([id]) => id),
        ),
        spend_reward_tracks: new Set(Object.keys(data.spend_reward_tracks || {})),
    };
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
 * Returns `{ changes }` (lines to print) or `{ error }`.
 */
function recordRun(data, ids, start, end) {
    const staged = {};
    const changes = [];
    for (const id of ids) {
        const runs = (data.schedule?.[id] || []).map((run) => ({ ...run }));
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
            changes.push(`  ${id}: ${start}..${end}`);
            runs.push({ start, end });
        }
        staged[id] = runs;
    }
    data.schedule = { ...data.schedule, ...staged };
    return { changes };
}

/** Today's game day (it starts at 02:00 UTC, so before 04:00 CEST it's still yesterday) as YYYY-MM-DD. */
function gameToday() {
    return formatDay(gameDay(new Date()).day);
}

/** A day number as YYYY-MM-DD. */
function formatDay(day) {
    return dayDate(day).toISOString().slice(0, 10);
}

/** Whether `text` is a real calendar date written YYYY-MM-DD (not 2026-02-30). */
function isValidDate(text) {
    return DATE_PATTERN.test(text) && formatDay(dayNumber(text)) === text;
}

/** The date `days` after `text` (YYYY-MM-DD). */
function addDays(text, days) {
    return formatDay(dayNumber(text) + days);
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
 * Ids with a repeating pattern (a forecast the Calendar trusts as runs) whose last recorded run is over 8 weeks old
 * (`stale`, see forecastRuns): the pattern no longer counts until its latest run is recorded again.
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
            stale.push(`  ${id}: last recorded ${daysText(formatDay(last.start), formatDay(last.end))}`);
        }
    }
    console.log(
        stale.length > 0
            ? `\nProven patterns last recorded over 8 weeks ago (record their latest run):\n${stale.join('\n')}`
            : '\nEvery proven pattern was recorded within the last 8 weeks.',
    );
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

export { addDays, daysText, isValidDate, parseRecordArgs, recordRun, recordableIds };

if (isMain(import.meta)) {
    main();
}

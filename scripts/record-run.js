import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'pack_data.json');
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
 *   START  first day, YYYY-MM-DD (default: today)
 *   DAYS   how many days it runs, the start day included (end = START + DAYS - 1)
 *   --show print the recorded runs (of the given ids, or all; nothing is written)
 * A run with the same start as a recorded one replaces it (to correct its length); other overlaps are refused.
 */
function main() {
    const args = process.argv.slice(2);
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const kinds = {
        events: new Set(Object.keys(data.events || {})),
        seasonal_passes: new Set(
            Object.entries(data.packages || {})
                .filter(([, pkg]) => pkg.seasonal)
                .map(([id]) => id),
        ),
        spend_reward_tracks: new Set(Object.keys(data.spend_reward_tracks || {})),
    };
    const dates = args.filter((arg) => DATE_PATTERN.test(arg));
    const counts = args.filter((arg) => DAYS_PATTERN.test(arg));
    const ids = args.filter((arg) => !arg.startsWith('--') && !DATE_PATTERN.test(arg) && !DAYS_PATTERN.test(arg));

    if (args.includes('--show')) {
        printSchedule(data.schedule || {}, ids);
        return;
    }
    // Nothing to record (or --help): show how to use it.
    if (ids.length === 0 || args.includes('--help')) {
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
    const start = dates[0] || formatDate(new Date());
    if (formatDate(toDate(start)) !== start) {
        fail(`Invalid date "${start}". Use YYYY-MM-DD.`);
    }
    const end = addDays(start, Number(counts[0]) - 1);

    data.schedule = data.schedule || {};
    const changes = [];
    for (const id of ids) {
        const runs = data.schedule[id] || [];
        const same = runs.find((run) => run.start === start);
        const overlap = runs.find((run) => run !== same && run.start <= end && start <= run.end);
        if (overlap) {
            fail(
                `${id}: ${start}..${end} overlaps its recorded run ${overlap.start}..${overlap.end}. Nothing was written. ` +
                    'Fix it in data/pack_data.json ("schedule") if that run is wrong.',
            );
        }
        if (same) {
            changes.push(`  ${id}: ${same.start}..${same.end} -> ${start}..${end} (updated)`);
            same.end = end;
        } else {
            changes.push(`  ${id}: ${start}..${end}`);
            runs.push({ start, end });
        }
        data.schedule[id] = runs;
    }
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 4)}\n`, 'utf8');

    // Same tidy-up as the commit hook: sorted sections, prettier formatting.
    execSync('node scripts/sort-pack-data.js', { cwd: ROOT, stdio: 'inherit' });
    execSync('npx prettier --write data/pack_data.json', { cwd: ROOT, stdio: 'ignore' });

    console.log(`Recorded (${daysText(start, end)}):`);
    console.log(changes.join('\n'));
}

function toDate(text) {
    const [year, month, day] = text.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function formatDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(text, days) {
    const date = toDate(text);
    date.setDate(date.getDate() + days);
    return formatDate(date);
}

/** "Mon 2026-10-12 .. Sun 2026-10-18, 7 days" */
function daysText(start, end) {
    const weekday = (text) => toDate(text).toLocaleDateString('en', { weekday: 'short' });
    const days = Math.round((toDate(end) - toDate(start)) / 86400000) + 1;
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
        `Today: ${daysText(formatDate(new Date()), formatDate(new Date()))}.`,
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

function fail(message) {
    console.error(message);
    process.exit(1);
}

main();

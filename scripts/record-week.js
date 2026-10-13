const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'pack_data.json');
const WEEK_PATTERN = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Records which events, seasonal passes and spend reward tracks run in a week, in the `schedule` section of
 * data/pack_data.json (ISO calendar weeks; the game's week starts on Monday). Groundwork for a forecast.
 *
 * Usage: npm run record-week -- [ids...] [--week YYYY-Www] [--days FROM..TO | D1,D2] [--replace] [--show] [--help]
 *   (no ids / --help: prints the usage with examples and the valid ids)
 *   ids        event ids (incl. in-game events), seasonal pass family ids and/or spend reward track ids
 *              (classified automatically)
 *   --week     the week to record (default: the week of --days, else the current ISO week)
 *   --days     exact dates of the ids in this call (e.g. 2026-10-12..2026-10-13), for events shorter than a week;
 *              all in one week
 *   --replace  overwrite the week's entry instead of adding to it
 *   --show     print the recorded weeks (nothing is written)
 */
function main() {
    const args = process.argv.slice(2);
    const show = args.includes('--show');
    const replace = args.includes('--replace');
    const valueOf = (flag) => {
        const index = args.indexOf(flag);
        return index >= 0 ? { index: index + 1, value: args[index + 1] } : { index: -1, value: null };
    };
    const weekArg = valueOf('--week');
    const daysArg = valueOf('--days');
    const ids = args.filter(
        (arg, index) => !arg.startsWith('--') && index !== weekArg.index && index !== daysArg.index,
    );

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
    if (show) {
        printSchedule(data.schedule || {});
        return;
    }
    // Nothing to record (or --help): show how to use it.
    if (ids.length === 0 || args.includes('--help')) {
        printUsage(kinds, data.events || {});
        return;
    }

    const days = daysArg.index >= 0 ? parseDays(daysArg.value) : [];
    const week = weekArg.value || (days.length > 0 ? isoWeek(toDate(days[0])) : isoWeek(new Date()));
    if (!WEEK_PATTERN.test(week || '')) {
        fail(`Invalid week "${week}". Use the ISO format YYYY-Www, e.g. 2026-W42.`);
    }
    const outside = days.filter((day) => isoWeek(toDate(day)) !== week);
    if (outside.length > 0) {
        fail(`${outside.join(', ')} not in ${week}. Record each week separately (one --days range per week).`);
    }

    const additions = { events: [], seasonal_passes: [], spend_reward_tracks: [] };
    const unknown = [];
    for (const id of ids) {
        const kind = Object.keys(kinds).find((key) => kinds[key].has(id));
        if (kind) {
            additions[kind].push(id);
        } else {
            unknown.push(id);
        }
    }
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

    data.schedule = data.schedule || {};
    const entry = replace ? {} : { ...(data.schedule[week] || {}) };
    for (const [key, list] of Object.entries(additions)) {
        const merged = [...new Set([...(entry[key] || []), ...list])];
        if (merged.length > 0) {
            entry[key] = merged;
        } else {
            delete entry[key];
        }
    }
    if (days.length > 0) {
        entry.days = { ...(entry.days || {}) };
        for (const id of ids) {
            entry.days[id] = [...new Set([...(entry.days[id] || []), ...days])];
        }
    }
    data.schedule[week] = entry;
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 4)}\n`, 'utf8');

    // Same tidy-up as the commit hook: sorted sections, prettier formatting.
    execSync('node scripts/sort-pack-data.js', { cwd: ROOT, stdio: 'inherit' });
    execSync('npx prettier --write data/pack_data.json', { cwd: ROOT, stdio: 'ignore' });

    const saved = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')).schedule[week];
    console.log(`${replace ? 'Replaced' : 'Recorded'} ${week}:`);
    printEntry(saved);
}

/** "2026-10-12..2026-10-14" (a range) or "2026-10-12,2026-10-14" (a list) -> sorted dates. */
function parseDays(text) {
    if (!text) {
        fail('--days needs dates, e.g. --days 2026-10-12..2026-10-13');
    }
    let dates;
    if (text.includes('..')) {
        const [from, to] = text.split('..');
        if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
            fail(`Invalid range "${text}". Use FROM..TO, e.g. 2026-10-12..2026-10-13.`);
        }
        dates = [];
        for (let day = toDate(from); formatDate(day) <= to; day.setDate(day.getDate() + 1)) {
            dates.push(formatDate(day));
        }
    } else {
        dates = text.split(',');
    }
    const invalid = dates.filter((day) => !DATE_PATTERN.test(day) || formatDate(toDate(day)) !== day);
    if (invalid.length > 0) {
        fail(`Invalid date(s): ${invalid.join(', ')}. Use YYYY-MM-DD.`);
    }
    return [...new Set(dates)].sort();
}

function toDate(text) {
    const [year, month, day] = text.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function formatDate(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** ISO 8601 week of a date ("2026-W42"): weeks start on Monday, week 1 contains the year's first Thursday. */
function isoWeek(date) {
    const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const weekday = day.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
    day.setUTCDate(day.getUTCDate() + 4 - weekday); // the week's Thursday decides its year
    const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
    return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Usage with examples, the current week and every id that can be recorded. */
function printUsage(kinds, events) {
    const ingame = [...kinds.events].filter((id) => events[id]?.category === 'ingame_event');
    const shoppable = [...kinds.events].filter((id) => events[id]?.category !== 'ingame_event');
    const lines = [
        'Records which events, seasonal passes and spend reward tracks run in a week (data/pack_data.json "schedule").',
        '',
        'Usage: npm run record-week -- <ids...> [--week YYYY-Www] [--days FROM..TO] [--replace]',
        '       npm run record-week -- --show',
        '',
        'Examples:',
        '  npm run record-week -- strange_bazaar gear_pass ancient_recipe_gearstone   # this week, added to what is there',
        '  npm run record-week -- --week 2026-W41 recluse_merchant                    # another week',
        '  npm run record-week -- --days 2026-10-12..2026-10-13 claires_inner_demon   # a short event, with its dates',
        '  npm run record-week -- --replace strange_bazaar                            # overwrite this week',
        '  npm run record-week -- --show                                              # list recorded weeks',
        '',
        `This week: ${isoWeek(new Date())} (weeks start on Monday). A 2-week run is recorded in both weeks.`,
        '',
        'Ids you can record:',
        `  Events:               ${shoppable.join(', ')}`,
        `  In-game events:       ${ingame.join(', ') || '-'}`,
        `  Seasonal passes:      ${[...kinds.seasonal_passes].join(', ')}`,
        `  Spend reward tracks:  ${[...kinds.spend_reward_tracks].join(', ')}`,
    ];
    console.log(lines.join('\n'));
}

function printEntry(entry) {
    const withDays = (ids) =>
        (ids || []).map((id) => (entry.days?.[id] ? `${id} (${entry.days[id].join(', ')})` : id)).join(', ') || '-';
    console.log(`  Events:              ${withDays(entry.events)}`);
    console.log(`  Seasonal passes:     ${withDays(entry.seasonal_passes)}`);
    console.log(`  Spend reward tracks: ${withDays(entry.spend_reward_tracks)}`);
}

function printSchedule(schedule) {
    const weeks = Object.keys(schedule).sort();
    if (weeks.length === 0) {
        console.log('No weeks recorded yet.');
        return;
    }
    for (const week of weeks) {
        console.log(week);
        printEntry(schedule[week]);
    }
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

main();

import fs from 'node:fs';
import path from 'node:path';
import { PACK_DATA_PATH, EVENTS_PATH, readJson, writeJson, isMain } from './lib/data-files.js';

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortByKey(object) {
    return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

function sortByNumericKey(object) {
    return Object.fromEntries(Object.entries(object).sort(([a], [b]) => Number(a) - Number(b)));
}

/**
 * Sorts the sections of the pack data in place (and returns it): ids alphabetical, numeric keys by number. Orders
 * that are the data's meaning (guide paths) stay.
 */
function sortPackData(data) {
    for (const sectionName of ['items', 'packages', 'exchange_shops', 'mines', 'spend_reward_tracks']) {
        if (isObject(data[sectionName])) {
            data[sectionName] = sortByKey(data[sectionName]);
        }
    }

    for (const shop of Object.values(data.exchange_shops ?? {})) {
        if (isObject(shop.offers)) {
            shop.offers = sortByKey(shop.offers);
        }

        if (isObject(shop.bonus_tiers)) {
            shop.bonus_tiers = sortByNumericKey(shop.bonus_tiers);
        }
    }

    for (const mine of Object.values(data.mines ?? {})) {
        if (isObject(mine.progress_rewards)) {
            mine.progress_rewards = sortByNumericKey(mine.progress_rewards);
        }
    }

    for (const pkg of Object.values(data.packages ?? {})) {
        if (isObject(pkg.tiers)) {
            pkg.tiers = sortByNumericKey(pkg.tiers);
        }
    }

    if (Array.isArray(data.spend_reward_conversions)) {
        data.spend_reward_conversions = [...data.spend_reward_conversions].sort((a, b) => a.price - b.price);
    }
    for (const track of Object.values(data.spend_reward_tracks ?? {})) {
        if (isObject(track.tiers)) {
            track.tiers = sortByNumericKey(track.tiers);
        }
        if (Array.isArray(track.conversions)) {
            track.conversions = [...track.conversions].sort((a, b) => a.price - b.price);
        }
    }

    // Heroes, gear sets and squad guides by id (a guide's path keeps its order: the order is its meaning).
    for (const key of ['heroes', 'gear_upgrades', 'squad_guides']) {
        if (isObject(data[key])) {
            data[key] = sortByKey(data[key]);
        }
    }
    return data;
}

/**
 * Sorts the sections of the event data (events.json) in place (and returns it): the events and the schedule's ids
 * alphabetical, each id's runs oldest first. The event rotations keep their order, the order of the Calendar's
 * charts, and so do their phases: the order is the cycle.
 */
function sortEventData(data) {
    if (isObject(data.events)) {
        data.events = sortByKey(data.events);
    }
    if (isObject(data.schedule)) {
        data.schedule = sortByKey(data.schedule);
        for (const [id, runs] of Object.entries(data.schedule)) {
            if (Array.isArray(runs)) {
                data.schedule[id] = [...runs].sort((a, b) => String(a.start).localeCompare(String(b.start)));
            }
        }
    }
    return data;
}

/**
 * Sorts the data files named on the command line (the commit hook passes the staged ones), or both of them without
 * arguments.
 */
function main() {
    const sorters = new Map([
        [PACK_DATA_PATH, sortPackData],
        [EVENTS_PATH, sortEventData],
    ]);
    const named = process.argv.slice(2).map((file) => path.resolve(file));
    for (const file of named.length > 0 ? named : sorters.keys()) {
        if (sorters.has(file) && fs.existsSync(file)) {
            writeJson(file, sorters.get(file)(readJson(file)));
        }
    }
}

export { sortPackData, sortEventData };

if (isMain(import.meta)) {
    main();
}

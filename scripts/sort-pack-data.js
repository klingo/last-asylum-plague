import fs from 'node:fs';
import path from 'node:path';

const DATA_PATH = path.join(import.meta.dirname, '..', 'data', 'pack_data.json');

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortByKey(object) {
    return Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
}

function sortByNumericKey(object) {
    return Object.fromEntries(Object.entries(object).sort(([a], [b]) => Number(a) - Number(b)));
}

if (fs.existsSync(DATA_PATH)) {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

    for (const sectionName of ['items', 'packages', 'exchange_shops', 'mines', 'events', 'spend_reward_tracks']) {
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

    // Schedule: ids alphabetical, each id's runs oldest first.
    if (isObject(data.schedule)) {
        data.schedule = sortByKey(data.schedule);
        for (const [id, runs] of Object.entries(data.schedule)) {
            if (Array.isArray(runs)) {
                data.schedule[id] = [...runs].sort((a, b) => String(a.start).localeCompare(String(b.start)));
            }
        }
    }

    fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 4)}\n`, 'utf8');
}

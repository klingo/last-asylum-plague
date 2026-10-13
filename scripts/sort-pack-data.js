const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'pack_data.json');

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

    for (const sectionName of ['items', 'packages', 'exchange_shops', 'events', 'spend_reward_tracks']) {
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

    // Weekly schedule: weeks in order, each list alphabetical.
    if (isObject(data.schedule)) {
        data.schedule = sortByKey(data.schedule);
        for (const entry of Object.values(data.schedule)) {
            for (const key of ['events', 'seasonal_passes', 'spend_reward_tracks']) {
                if (Array.isArray(entry[key])) {
                    entry[key] = [...entry[key]].sort((a, b) => a.localeCompare(b));
                }
            }
            if (isObject(entry.days)) {
                entry.days = sortByKey(entry.days);
                for (const [id, dates] of Object.entries(entry.days)) {
                    entry.days[id] = [...dates].sort();
                }
            }
        }
    }

    fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 4)}\n`, 'utf8');
}

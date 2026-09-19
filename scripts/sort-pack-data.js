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

    for (const sectionName of ['items', 'packages', 'exchange_shops', 'events']) {
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

    fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 4)}\n`, 'utf8');
}

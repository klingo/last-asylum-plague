import fs from 'node:fs';
import path from 'node:path';
import { PACK_DATA_PATH, EVENTS_PATH, readJson, writeJson, isMain } from './lib/data-files.js';

/** `date` as YYYY-MM-DD in local time. */
function localDate(date) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** Sets `metadata.last_updated` of `data` to `today`; false if it was already that. */
function stampLastUpdated(data, today) {
    data.metadata ??= {};
    if (data.metadata.last_updated === today) {
        return false;
    }
    data.metadata.last_updated = today;
    return true;
}

/**
 * Stamps the data files named on the command line (the commit hook passes the staged ones, the record-run workflow
 * events.json), pack_data.json without arguments. Each file has its own date.
 */
function main() {
    const today = localDate(new Date());
    const named = process.argv.slice(2).map((file) => path.resolve(file));
    for (const file of named.length > 0 ? named : [PACK_DATA_PATH]) {
        if (![PACK_DATA_PATH, EVENTS_PATH].includes(file) || !fs.existsSync(file)) {
            continue;
        }
        const data = readJson(file);
        if (stampLastUpdated(data, today)) {
            writeJson(file, data);
            console.log(`Updated ${path.basename(file)} metadata.last_updated to ${today}`);
        }
    }
}

export { localDate, stampLastUpdated };

if (isMain(import.meta)) {
    main();
}

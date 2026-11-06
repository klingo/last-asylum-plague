import fs from 'node:fs';
import { PACK_DATA_PATH, readJson, writeJson, isMain } from './lib/data-files.js';

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

function main() {
    if (!fs.existsSync(PACK_DATA_PATH)) {
        return;
    }
    const data = readJson(PACK_DATA_PATH);
    const today = localDate(new Date());
    if (stampLastUpdated(data, today)) {
        writeJson(PACK_DATA_PATH, data);
        console.log(`Updated metadata.last_updated to ${today}`);
    }
}

export { localDate, stampLastUpdated };

if (isMain(import.meta)) {
    main();
}

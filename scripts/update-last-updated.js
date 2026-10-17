import fs from 'node:fs';
import path from 'node:path';

const DATA_PATH = path.join(import.meta.dirname, '..', 'data', 'pack_data.json');

function updateLastUpdated() {
    if (!fs.existsSync(DATA_PATH)) {
        return;
    }

    const content = fs.readFileSync(DATA_PATH, 'utf8');
    const data = JSON.parse(content);

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;

    if (!data.metadata) {
        data.metadata = {};
    }

    if (data.metadata.last_updated !== today) {
        data.metadata.last_updated = today;
        fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 4)}\n`, 'utf8');
        console.log(`Updated metadata.last_updated to ${today}`);
    }
}

updateLastUpdated();

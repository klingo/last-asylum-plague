/**
 * The pack data (data/pack_data.json, the economy) and the event calendar (data/events.json), both bundled by Vite,
 * that back every page of the webapp, merged, with package tier ladders expanded into one SKU per tier
 * (core/pack-data.js). Everything is computed live in the browser from these files. The nav shows the date of
 * pack_data.json.
 */
import rawData from '../../../data/pack_data.json';
import eventData from '../../../data/events.json';
import { normalizePackData } from '../core/pack-data.js';
import { setItemImageAliases } from './images.js';
import { showDataDate } from './nav.js';

async function loadPackData() {
    const data = normalizePackData(rawData, eventData);
    setItemImageAliases(data.items);
    showDataDate(data.metadata?.last_updated);
    return data;
}

export { loadPackData };

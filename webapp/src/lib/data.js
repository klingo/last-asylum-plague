/**
 * The pack data (data/pack_data.json, bundled by Vite) that backs every page of the webapp, with
 * package tier ladders expanded into one SKU per tier (core/pack-data.js). Everything is computed
 * live in the browser from this file.
 */
import rawData from '../../../data/pack_data.json';
import { normalizePackData } from '../core/pack-data.js';
import { setItemImageAliases } from './images';
import { showDataDate } from '../nav';

async function loadPackData() {
    const data = normalizePackData(rawData);
    setItemImageAliases(data.items);
    showDataDate(data.metadata?.last_updated);
    return data;
}

export { loadPackData };

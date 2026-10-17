/**
 * The pack data (data/pack_data.json, bundled by Vite) that backs every page of the webapp, with
 * package tier ladders expanded into one SKU per tier (see catalog.js). Everything is computed
 * live in the browser from this file.
 */
import rawData from '../../../data/pack_data.json';
import { expandPackageFamilies } from './catalog.js';
import { setItemImageAliases } from './images';
import { showDataDate } from '../nav';

async function loadPackData() {
    const data = { ...rawData, packages: expandPackageFamilies(rawData.packages || {}) };
    setItemImageAliases(data.items);
    showDataDate(data.metadata?.last_updated);
    return data;
}

export { loadPackData };

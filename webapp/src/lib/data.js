/**
 * Loads the raw pack data (copied into public/data by scripts/copy-pack-data.js as part of
 * the build) that backs every page of the webapp, with package tier ladders expanded into one
 * SKU per tier (see catalog.js). Everything is computed live in the browser from this file.
 */
import { t } from './i18n';
import { expandPackageFamilies } from './catalog.js';

async function fetchJson(fileName) {
    const url = `${import.meta.env.BASE_URL}data/${fileName}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            t('common.fetchError', { file: fileName, status: response.status, statusText: response.statusText }),
        );
    }
    return response.json();
}

async function loadPackData() {
    const data = await fetchJson('pack_data.json');
    if (data.packages) {
        data.packages = expandPackageFamilies(data.packages);
    }
    return data;
}

export { fetchJson, loadPackData };

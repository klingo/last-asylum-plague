/**
 * Loads the raw pack data (copied into public/data by scripts/copy-pack-data.js as part of
 * the build) that backs both pages of the webapp. All analysis/ranking is computed live in
 * the browser from this file; no pre-generated ranking/index files are involved.
 */
import { t } from './i18n';

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

/**
 * `pack_data.json` authors a package "family" (e.g. a T1/T2 daily offer ladder) as one object
 * with a `tiers` map keyed by tier number, so a not-yet-known tier can be left out without
 * shifting any other tier's number. Every other part of the webapp still wants the flat,
 * one-SKU-per-id shape this used to be authored in directly (`awaken_shard_t1`, `_t2`, ...),
 * each carrying its own `tier` and a `requires` link to the previous tier present in the map
 * (or null for the lowest one). This expands the former into the latter right after loading,
 * so nothing downstream has to know families exist. Mirror any change here in
 * scripts/lib/pricing.js's `expandPackageFamilies`.
 */
function expandPackageFamilies(packages) {
    const expanded = {};
    for (const [id, pkg] of Object.entries(packages)) {
        if (!pkg.tiers) {
            expanded[id] = pkg;
            continue;
        }
        const { tiers, ...family } = pkg;
        const tierNumbers = Object.keys(tiers)
            .map(Number)
            .sort((a, b) => a - b);
        let previousId = null;
        for (const tierNum of tierNumbers) {
            const tierId = `${id}_t${tierNum}`;
            expanded[tierId] = {
                ...family,
                ...tiers[String(tierNum)],
                tier: tierNum,
                requires: previousId,
            };
            previousId = tierId;
        }
    }
    return expanded;
}

async function loadPackData() {
    const data = await fetchJson('pack_data.json');
    if (data.packages) {
        data.packages = expandPackageFamilies(data.packages);
    }
    return data;
}

export { fetchJson, loadPackData };

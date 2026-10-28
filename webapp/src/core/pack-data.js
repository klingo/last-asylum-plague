/**
 * pack_data.json as the core modules read it. Everything in core/ takes the NORMALIZED data: package tier
 * ladders expanded into one package per tier (`normalizePackData`, once, when the data is loaded: ui
 * data.js, scripts/verify-data.js after its schema checks, the tests).
 */

/**
 * `pack_data.json` authors a package family (e.g. a T1/T2 daily offer ladder) as one object
 * with a `tiers` map. Everything downstream wants one flat SKU per id (`awaken_shard_t1`, ...),
 * each with its own `tier` and a `requires` link to the previous tier (null for the lowest).
 * Already expanded packages are kept as they are.
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
            expanded[tierId] = { ...family, ...tiers[String(tierNum)], tier: tierNum, requires: previousId };
            previousId = tierId;
        }
    }
    return expanded;
}

/** A (flattened) package's family id: tiers `<family>_t<N>` share one. */
function packageFamilyId(id, pkg) {
    return pkg.tier != null ? id.replace(/_t\d+$/, '') : id;
}

/**
 * The shops with only their complete offers. An offer without a positive cost and quantity is still being
 * entered (verify-data reports it); left in, its NaN spoils the whole fit and the plan would get it for free.
 */
function completeShops(shops) {
    return Object.fromEntries(
        Object.entries(shops).map(([id, shop]) => [
            id,
            {
                ...shop,
                offers: Object.fromEntries(
                    Object.entries(shop.offers || {}).filter(
                        ([, offer]) => offer.currency_cost > 0 && offer.quantity > 0,
                    ),
                ),
            },
        ]),
    );
}

/**
 * Spend reward tracks with their conversions filled in: a track without its own `conversions` counts with the shared
 * `spend_reward_conversions` (the same Banknote packs and points for every track). Its own list wins (`[]` = 1 point
 * per Banknote).
 */
function completeTracks(tracks, sharedConversions) {
    if (!Array.isArray(sharedConversions) || sharedConversions.length === 0) {
        return tracks;
    }
    return Object.fromEntries(
        Object.entries(tracks).map(([id, track]) => [
            id,
            Array.isArray(track.conversions) ? track : { ...track, conversions: sharedConversions },
        ]),
    );
}

/**
 * The raw pack data with its packages expanded, its shops complete and its spend reward tracks' conversions filled
 * in (the shape every core module expects).
 */
function normalizePackData(raw) {
    return {
        ...raw,
        packages: expandPackageFamilies(raw.packages || {}),
        ...(raw.exchange_shops ? { exchange_shops: completeShops(raw.exchange_shops) } : {}),
        ...(raw.spend_reward_tracks
            ? { spend_reward_tracks: completeTracks(raw.spend_reward_tracks, raw.spend_reward_conversions) }
            : {}),
    };
}

export { normalizePackData, expandPackageFamilies, packageFamilyId };

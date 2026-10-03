/**
 * What can be bought, and how often. Pure data rules shared by every valuation module — no DOM,
 * no i18n — so Node scripts (verify-data) can import it too.
 *
 * All capacities are "purchases per week", the unit both the simple and the accurate model
 * work in:
 * - daily limits count once per available day (7, or the number of `available_days`);
 * - weekly limits count once; monthly limits count 7/30 (the pass delivers its contents over
 *   30 days, so a week gets 7/30 of it for 7/30 of the price);
 * - `exclusive`/`event` limits are the total for the offer's lifetime (once, when included);
 * - `purchase_limit: null` (plain diamond top-ups) is unlimited.
 *
 * The planners (acquire.js) instead count purchases inside a window of days. With a start weekday
 * the window is a real calendar: daily limits count the window's available days, weekly limits
 * the Monday-based weeks it touches (weekly limits reset on Monday).
 */

const PASS_CATEGORIES = new Set(['weekly_pass', 'premium_monthly_pass']);

const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
// Monday first: weekly limits reset on Monday, so a weekday's index is its offset into the week.
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function isPassCategory(category) {
    return PASS_CATEGORIES.has(category);
}

/** Days over which a package delivers its `contains` (calendar packs, passes); 1 = all at once. */
function deliveryPeriod(pkg) {
    if (pkg.delivery_days) {
        return pkg.delivery_days;
    }
    if (isPassCategory(pkg.category)) {
        return pkg.limit_type === 'monthly' ? DAYS_PER_MONTH : DAYS_PER_WEEK;
    }
    return 1;
}

/**
 * `pack_data.json` authors a package family (e.g. a T1/T2 daily offer ladder) as one object
 * with a `tiers` map. Everything downstream wants one flat SKU per id (`awaken_shard_t1`, ...),
 * each with its own `tier` and a `requires` link to the previous tier (null for the lowest).
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
 * True for a seasonal package (`seasonal: true`, e.g. the Gear Pass) the user marked as not on sale
 * right now (`unavailablePasses`: Set of family ids). Packages without the flag are always available.
 */
function isUnavailablePass(id, pkg, unavailablePasses) {
    return Boolean(pkg.seasonal) && Boolean(unavailablePasses?.size) && unavailablePasses.has(packageFamilyId(id, pkg));
}

/** Every item used as an exchange-shop currency (diamonds, event coins, ...). */
function currencyItemIds(exchangeShops) {
    return new Set(Object.values(exchangeShops || {}).map((shop) => shop.currency_item_id));
}

/** How many times per week a limit allows buying, before any availability toggles. */
function perWeek(purchaseLimit, limitType, availableDays) {
    if (purchaseLimit == null) {
        return Infinity;
    }
    switch (limitType) {
        case 'daily':
            return purchaseLimit * (availableDays?.length || DAYS_PER_WEEK);
        case 'monthly':
            return (purchaseLimit * DAYS_PER_WEEK) / DAYS_PER_MONTH;
        default:
            // weekly, exclusive, event
            return purchaseLimit;
    }
}

/**
 * Purchases per week of a (flattened) package under the given toggles; 0 = not available.
 * - Event-tied packages need their event in `activeEventIds` (null = every event active).
 * - Once-ever (`exclusive`) packages without an event need `includeExclusives`.
 * - Passes need `includePasses`.
 */
function packageWeeklyCapacity(pkg, { activeEventIds = null, includePasses = true, includeExclusives = false } = {}) {
    if (pkg.event_id) {
        if (activeEventIds && !activeEventIds.has(pkg.event_id)) {
            return 0;
        }
    } else if (pkg.limit_type === 'exclusive' && !includeExclusives) {
        return 0;
    }
    if (isPassCategory(pkg.category) && !includePasses) {
        return 0;
    }
    return perWeek(pkg.purchase_limit, pkg.limit_type, pkg.available_days);
}

/** Purchases per week of an exchange-shop offer; 0 if the shop's event isn't active. */
function offerWeeklyCapacity(offer, shop, { activeEventIds = null } = {}) {
    if (shop.event_id && activeEventIds && !activeEventIds.has(shop.event_id)) {
        return 0;
    }
    return perWeek(offer.purchase_limit, offer.limit_type, null);
}

/**
 * Purchases a limit allows within a window of `days` days (planners). Event-tied limits never
 * scale past one event run (7 days); exclusive/event limits never scale; monthly limits count per
 * started 30 days.
 * - `startDay`: weekday index of the window's first day (0 = Monday). Then daily limits count the
 *   window's available days and weekly limits the Monday-based weeks with an available day.
 *   Without it, daily limits count available days proportionally (rounded up) and weekly limits
 *   per started 7 days.
 */
function capacityInWindow(
    purchaseLimit,
    limitType,
    { days, startDay = null, availableDays = null, eventTied = false },
) {
    if (purchaseLimit == null) {
        return Infinity;
    }
    const horizon = eventTied ? Math.min(days, DAYS_PER_WEEK) : days;
    if (limitType === 'monthly') {
        return purchaseLimit * Math.ceil(horizon / DAYS_PER_MONTH);
    }
    if (limitType !== 'daily' && limitType !== 'weekly') {
        return purchaseLimit;
    }
    if (startDay == null) {
        if (limitType === 'weekly') {
            return purchaseLimit * Math.ceil(horizon / DAYS_PER_WEEK);
        }
        return availableDays?.length
            ? purchaseLimit * Math.ceil((horizon * availableDays.length) / DAYS_PER_WEEK)
            : purchaseLimit * horizon;
    }
    const available = availableDays?.length ? new Set(availableDays) : null;
    let openDays = 0;
    const weeks = new Set();
    for (let offset = 0; offset < horizon; offset++) {
        const index = startDay + offset;
        if (available && !available.has(WEEKDAYS[index % DAYS_PER_WEEK])) {
            continue;
        }
        openDays++;
        weeks.add(Math.floor(index / DAYS_PER_WEEK));
    }
    return purchaseLimit * (limitType === 'daily' ? openDays : weeks.size);
}

/**
 * Purchases of a (flattened) package possible within `days` (see capacityInWindow).
 * - Event-tied packages need their event in `activeEventIds` (null = all) and ignore their limit
 *   entirely with `exceedEventPackLimits`.
 * - Once-ever (`exclusive`) packages without an event need `includeExclusives`.
 */
function packageCapacityForDays(
    pkg,
    days,
    { activeEventIds = null, exceedEventPackLimits = false, includeExclusives = true, startDay = null } = {},
) {
    if (pkg.event_id) {
        if (activeEventIds && !activeEventIds.has(pkg.event_id)) {
            return 0;
        }
        if (exceedEventPackLimits) {
            return Infinity;
        }
    } else if (pkg.limit_type === 'exclusive' && !includeExclusives) {
        return 0;
    }
    return capacityInWindow(pkg.purchase_limit, pkg.limit_type, {
        days,
        startDay,
        availableDays: pkg.available_days,
        eventTied: Boolean(pkg.event_id),
    });
}

export {
    PASS_CATEGORIES,
    DAYS_PER_WEEK,
    isPassCategory,
    expandPackageFamilies,
    packageFamilyId,
    isUnavailablePass,
    currencyItemIds,
    packageWeeklyCapacity,
    offerWeeklyCapacity,
    WEEKDAYS,
    deliveryPeriod,
    capacityInWindow,
    packageCapacityForDays,
};

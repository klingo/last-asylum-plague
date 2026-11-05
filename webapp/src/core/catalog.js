/**
 * What can be bought, and how often. Pure data rules shared by every valuation module — no DOM,
 * no i18n — so Node scripts (verify-data) can import it too.
 *
 * All capacities are "purchases per week", the unit the weekly plan (planner.js) works in:
 * - daily limits count once per available day (7, or the number of `available_days`);
 * - weekly limits count once; biweekly limits 7/14 and monthly limits 7/30 (the pass delivers its
 *   contents over 14 / 30 days, so a week gets that share of it for that share of the price);
 * - `lifetime` limits are the total ever, `event` limits the total per event run (when included);
 * - `purchase_limit: null` (plain diamond top-ups) is unlimited.
 *
 * The cheapest plan for needs (acquire.js) instead counts purchases inside a window of days. With a start weekday
 * the window is a real calendar: daily limits count the window's available days, weekly limits
 * the Monday-based weeks it touches (weekly limits reset on Monday).
 */

import { packageFamilyId } from './pack-data.js';
import { DAYS_PER_WEEK, WEEKDAYS } from './schedule.js';

// The days a biweekly / monthly limit covers (a pass delivers its contents over that long).
const LIMIT_PERIOD_DAYS = { biweekly: 14, monthly: 30 };

/** Whether an event is running: `activeEventIds` is the Set of running events (null = every event runs). */
function isEventActive(eventId, activeEventIds) {
    return !activeEventIds || activeEventIds.has(eventId);
}

/**
 * Whether a (flattened) package can't be bought at all under the toggles: its event isn't running, or it's a
 * lifetime-limited pack without an event while `includeExclusives` is off.
 */
function isBlocked(pkg, { activeEventIds, includeExclusives }) {
    return pkg.event_id ? !isEventActive(pkg.event_id, activeEventIds) : isLifetimeLimited(pkg) && !includeExclusives;
}

/** A pass: delivers its rewards over several days (`delivery_days`) and isn't tied to an event. */
function isPass(pkg) {
    return Boolean(pkg.delivery_days) && !pkg.event_id;
}

// Every value purchaseType returns (each has a `sourceType.<type>` label in the UI texts).
const PURCHASE_TYPES = ['top_up', 'event', 'unlock', 'limited', 'seasonal_pass', 'pass', 'package'];

/**
 * What kind of purchase a (flattened) package is, for its Type pill. The first matching rule wins:
 * diamond top-up, event pack (only while its event runs), once-only unlock, lifetime-limited pack,
 * seasonal pass, pass, plain package. Derived from the data, so nothing extra has to be maintained.
 */
function purchaseType(pkg) {
    if (pkg.category === 'diamond') {
        return 'top_up';
    }
    if (pkg.event_id) {
        return 'event';
    }
    if (pkg.category === 'unlock_exclusive') {
        return 'unlock';
    }
    if (pkg.limit_type === 'lifetime') {
        return 'limited';
    }
    if (isPass(pkg)) {
        return pkg.seasonal ? 'seasonal_pass' : 'pass';
    }
    return 'package';
}

/** A package that can only be bought `purchase_limit` times ever (the limit never resets). */
function isLifetimeLimited(pkg) {
    return pkg.limit_type === 'lifetime';
}

/** Days over which a package delivers its `contains` (passes, calendar packs); 1 = all at once. */
function deliveryPeriod(pkg) {
    return pkg.delivery_days || 1;
}

/**
 * True for a seasonal package (`seasonal: true`, e.g. the Gear Pass) that isn't on sale right now.
 * `seasonalPasses`: family ids of the seasonal passes on sale (several can be at once; undefined =
 * don't filter, e.g. for scripts). Packages without the flag are always available.
 */
function isSeasonalOff(id, pkg, seasonalPasses) {
    return seasonalPasses !== undefined && Boolean(pkg.seasonal) && !seasonalPasses.includes(packageFamilyId(id, pkg));
}

/**
 * Whether a (flattened) package is on sale this week: it has a price, its event (if any) is running and, if
 * it's seasonal, it's on sale. `activeEventIds`: Set (null = every event); `seasonalPasses`: family ids
 * (undefined = every seasonal pass, see isSeasonalOff).
 */
function isOnSale(id, pkg, { activeEventIds = null, seasonalPasses } = {}) {
    if (!(pkg.price > 0) || (pkg.event_id && !isEventActive(pkg.event_id, activeEventIds))) {
        return false;
    }
    return !isSeasonalOff(id, pkg, seasonalPasses);
}

/**
 * Pairs of (flattened) package ids that can't be owned together because the first one `bundles`
 * (already includes) the second, e.g. the Weekly Pass and the single weekly passes.
 * Returns `[[bundleId, includedId], ...]`.
 */
function bundledPairs(packages) {
    const pairs = [];
    for (const [id, pkg] of Object.entries(packages)) {
        for (const included of pkg.bundles || []) {
            for (const [otherId, other] of Object.entries(packages)) {
                if (packageFamilyId(otherId, other) === included) {
                    pairs.push([id, otherId]);
                }
            }
        }
    }
    return pairs;
}

/** Every item used as an exchange-shop or mine currency (diamonds, event coins, pickaxes, ...) in the pack data. */
function currencyItemIds(data) {
    return new Set(
        [...Object.values(data.exchange_shops || {}), ...Object.values(data.mines || {})].map(
            (owner) => owner.currency_item_id,
        ),
    );
}

/** How many times per week a limit allows buying, before any availability toggles. */
function perWeek(purchaseLimit, limitType, availableDays) {
    if (purchaseLimit == null) {
        return Infinity;
    }
    if (limitType === 'daily') {
        return purchaseLimit * (availableDays?.length || DAYS_PER_WEEK);
    }
    if (LIMIT_PERIOD_DAYS[limitType]) {
        return (purchaseLimit * DAYS_PER_WEEK) / LIMIT_PERIOD_DAYS[limitType];
    }
    // weekly, lifetime, event
    return purchaseLimit;
}

/**
 * Purchases per week of a (flattened) package under the given toggles; 0 = not available.
 * - Event-tied packages need their event in `activeEventIds` (null = every event active).
 * - Lifetime-limited packages without an event need `includeExclusives`.
 * - Passes need `includePasses`.
 * - `eventDaysLeft` (`{ eventId: days }`): only that many days of the event's run are left, so its daily
 *   limits count those days only.
 */
function packageWeeklyCapacity(
    pkg,
    { activeEventIds = null, includePasses = true, includeExclusives = false, eventDaysLeft = null } = {},
) {
    const daysLeft = pkg.event_id ? eventDaysLeft?.[pkg.event_id] : null;
    if (daysLeft != null) {
        const weekly = packageWeeklyCapacity(pkg, { activeEventIds, includePasses, includeExclusives });
        return Math.min(
            weekly,
            capacityInWindow(pkg.purchase_limit, pkg.limit_type, {
                days: daysLeft,
                availableDays: pkg.available_days,
                eventTied: true,
            }),
        );
    }
    if (isBlocked(pkg, { activeEventIds, includeExclusives }) || (isPass(pkg) && !includePasses)) {
        return 0;
    }
    return perWeek(pkg.purchase_limit, pkg.limit_type, pkg.available_days);
}

/**
 * Banknotes that `amount` coins (or diamonds, pickaxes) cost: bought from the (flattened) packages on sale that
 * give them, the cheapest per coin first, each only as often as it can be bought per week (its whole price
 * counted for the coins); more than all of them give per week at the dearest pack's rate. `eventDaysLeft` as in
 * packageWeeklyCapacity. `{ banknotes, packIds, available }` (available = the most coins the packs give within their limits), or null if no pack on sale gives them.
 */
function currencyCost(
    packages,
    currencyId,
    amount,
    { activeEventIds = null, seasonalPasses, eventDaysLeft = null } = {},
) {
    const packs = Object.entries(packages)
        .filter(([id, pkg]) => pkg.contains?.[currencyId] > 0 && isOnSale(id, pkg, { activeEventIds, seasonalPasses }))
        .map(([id, pkg]) => ({
            id,
            rate: pkg.price / pkg.contains[currencyId],
            coinsPerWeek: packageWeeklyCapacity(pkg, { activeEventIds, eventDaysLeft }) * pkg.contains[currencyId],
        }))
        .filter((pack) => pack.coinsPerWeek > 0)
        .sort((a, b) => a.rate - b.rate);
    if (packs.length === 0) {
        return null;
    }
    let banknotes = 0;
    let remaining = amount;
    const packIds = [];
    for (const pack of packs) {
        const coins = Math.min(remaining, pack.coinsPerWeek);
        banknotes += coins * pack.rate;
        remaining -= coins;
        packIds.push(pack.id);
        if (remaining <= 0) {
            break;
        }
    }
    banknotes += Math.max(0, remaining) * packs[packs.length - 1].rate;
    return { banknotes, packIds, available: packs.reduce((sum, pack) => sum + pack.coinsPerWeek, 0) };
}

/**
 * The (flattened) packages of an event on sale while it runs, `[{ id, pkg, limit }]` (`limit`: purchases per week,
 * also the ones the plan skips). `eventDaysLeft` as in packageWeeklyCapacity.
 */
function eventPacksOnSale(packages, eventId, { eventDaysLeft = null } = {}) {
    const rules = { activeEventIds: new Set([eventId]), eventDaysLeft };
    return Object.entries(packages)
        .filter(([id, pkg]) => pkg.event_id === eventId && isOnSale(id, pkg, rules))
        .map(([id, pkg]) => ({ id, pkg, limit: packageWeeklyCapacity(pkg, rules) }));
}

/** Most Banknotes the event's packages can take per week. */
function eventMaxSpend(packages, eventId, options) {
    return eventPacksOnSale(packages, eventId, options)
        .filter(({ limit }) => limit > 0)
        .reduce((sum, { pkg, limit }) => sum + limit * pkg.price, 0);
}

/** Price of the event's cheapest pack on sale (whole packs rarely hit a spend level exactly); 0 without one. */
function cheapestEventPackPrice(packages, eventId) {
    const prices = Object.entries(packages)
        .filter(([id, pkg]) => pkg.event_id === eventId && isOnSale(id, pkg))
        .map(([, pkg]) => pkg.price);
    return prices.length > 0 ? Math.min(...prices) : 0;
}

/** Purchases per week of an exchange-shop offer; 0 if the shop's event isn't active. */
function offerWeeklyCapacity(offer, shop, { activeEventIds = null } = {}) {
    if (shop.event_id && !isEventActive(shop.event_id, activeEventIds)) {
        return 0;
    }
    return perWeek(offer.purchase_limit, offer.limit_type, null);
}

/**
 * Purchases a limit allows within a window of `days` days (planners). Event-tied limits never
 * scale past one event run (7 days); lifetime/event limits never scale; biweekly / monthly limits count
 * per started 14 / 30 days.
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
    if (LIMIT_PERIOD_DAYS[limitType]) {
        return purchaseLimit * Math.ceil(horizon / LIMIT_PERIOD_DAYS[limitType]);
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
 * - Event-tied packages need their event in `activeEventIds` (null = all).
 * - Lifetime-limited packages without an event need `includeExclusives` (on by default here, unlike in
 *   packageWeeklyCapacity: Compare counts what can be had at all).
 */
function packageCapacityForDays(pkg, days, { activeEventIds = null, includeExclusives = true, startDay = null } = {}) {
    if (isBlocked(pkg, { activeEventIds, includeExclusives })) {
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
    purchaseType,
    PURCHASE_TYPES,
    bundledPairs,
    isEventActive,
    isSeasonalOff,
    isOnSale,
    currencyItemIds,
    packageWeeklyCapacity,
    eventPacksOnSale,
    eventMaxSpend,
    cheapestEventPackPrice,
    offerWeeklyCapacity,
    currencyCost,
    deliveryPeriod,
    capacityInWindow,
    packageCapacityForDays,
};

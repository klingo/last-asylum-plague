/**
 * How a solved weekly plan (planner.js) is told to the user: what it buys grouped by when to buy it (Today), the
 * purchases per period, and why it leaves a pack out although it is on sale (Deal Ranking). The pages turn the groups
 * into words and markup.
 *
 * Pure module (no DOM/i18n), shared with the tests.
 */
import { bundledPairs, packageWeeklyCapacity } from './catalog.js';
import { weekdayOfferTiming } from './schedule.js';

/** The purchases a plan line asks for: whole ones, per period for monthly and biweekly packs (at least 1). */
function plannedPurchases(pkg, count) {
    const periodic = pkg.limit_type === 'monthly' || pkg.limit_type === 'biweekly';
    return Math.max(1, Math.round(periodic ? count / packageWeeklyCapacity(pkg) : count));
}

/**
 * The plan by when to buy it, on game day `today`:
 * - `daily`, `weekly`: `[{ pkg, planned, spend }]` of the packs without event, by limit (`planned`: plannedPurchases);
 * - `rotation`: the weekday offers, the same plus `timing` (weekdayOfferTiming: today, upcoming or past);
 * - `byEvent`: Map eventId -> `{ packs: [{ pkg, planned, spend }], offers }` (`offers`: how many different shop
 *   offers of the event's shop the plan buys);
 * - `standing`: Map shopId -> how many different offers of a shop without event the plan buys.
 */
function groupPlanByWhen(plan, data, today) {
    const daily = [];
    const weekly = [];
    const rotation = [];
    const byEvent = new Map();
    const standing = new Map();
    const eventTile = (eventId) => {
        if (!byEvent.has(eventId)) {
            byEvent.set(eventId, { packs: [], offers: 0 });
        }
        return byEvent.get(eventId);
    };
    for (const { pkg, count, spend } of plan.purchases) {
        const entry = { pkg, planned: plannedPurchases(pkg, count), spend };
        if (pkg.event_id) {
            eventTile(pkg.event_id).packs.push(entry);
        } else if (pkg.category === 'weekly_rotation') {
            rotation.push({ ...entry, timing: weekdayOfferTiming(pkg.available_days, today) });
        } else if (pkg.limit_type === 'daily') {
            daily.push(entry);
        } else {
            weekly.push(entry);
        }
    }
    for (const { shopId } of plan.exchanges) {
        const shop = data.exchange_shops[shopId];
        if (shop.event_id) {
            eventTile(shop.event_id).offers += 1;
        } else {
            standing.set(shopId, (standing.get(shopId) || 0) + 1);
        }
    }
    return { daily, weekly, rotation, byEvent, standing };
}

/**
 * Why the plan leaves packages out although they're on sale, beyond the spend: package id ->
 * `{ kind: 'bundle' | 'group', causeId }` (the bundle that includes it / the member of its group bought instead).
 * `plannedIds`: the ids of the packages the plan buys (a Map or Set).
 */
function notBoughtReasons(packages, plannedIds) {
    const reasons = new Map();
    for (const [bundleId, includedId] of bundledPairs(packages)) {
        if (plannedIds.has(bundleId)) {
            reasons.set(includedId, { kind: 'bundle', causeId: bundleId });
        }
    }
    const boughtInGroup = new Map();
    for (const id of plannedIds.keys()) {
        const group = packages[id]?.exclusive_group;
        if (group) {
            boughtInGroup.set(group, id);
        }
    }
    for (const [id, pkg] of Object.entries(packages)) {
        const boughtId = pkg.exclusive_group && boughtInGroup.get(pkg.exclusive_group);
        if (boughtId && boughtId !== id && !reasons.has(id)) {
            reasons.set(id, { kind: 'group', causeId: boughtId });
        }
    }
    return reasons;
}

export { groupPlanByWhen, notBoughtReasons, plannedPurchases };

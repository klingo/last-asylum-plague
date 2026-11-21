/**
 * What the Event Shops page reads from the data and the weekly plan about one event: which event (and its shop and
 * mine) a tab stands for, whether the shop's currency also comes from outside the packs, every item the plan
 * gets from the event and the progress points it earns in the shop; and what one purchase of a shop offer costs the
 * plan (`offerPurchaseCost`, Item Sources).
 *
 * Pure module (no DOM/i18n), shared with the tests.
 */
import { eventPackSpend, eventPurchases } from './step-analysis.js';
import { expectedRolls } from './items.js';

/**
 * The selection of a tab: an event (`event:<id>`, with its shop and mine if any) or a shop without event
 * (`shop:<id>`); null for anything else.
 */
function eventSelection(data, key) {
    const [kind, id] = key.split(':');
    if (kind === 'event' && data.events?.[id]) {
        const shopEntry = Object.entries(data.exchange_shops || {}).find(([, shop]) => shop.event_id === id);
        const mineEntry = Object.entries(data.mines || {}).find(([, mine]) => mine.event_id === id);
        return {
            eventId: id,
            shopId: shopEntry?.[0] ?? null,
            shop: shopEntry?.[1] ?? null,
            mineId: mineEntry?.[0] ?? null,
            mine: mineEntry?.[1] ?? null,
        };
    }
    if (kind === 'shop' && data.exchange_shops?.[id]) {
        return { eventId: null, shopId: id, shop: data.exchange_shops[id] };
    }
    return null;
}

/**
 * Whether a shop's currency also comes from outside the packs: a shop without event (VIP Shop, Alliance Shop), or
 * one of an event none of whose packs gives the shop's currency (Thief Hunt: lion coins come from killing thieves).
 * The user enters how much of it they get.
 */
function hasOutsideCurrency(packages, shop) {
    if (!shop) {
        return false;
    }
    return (
        !shop.event_id ||
        !Object.values(packages).some(
            (pkg) => pkg.event_id === shop.event_id && pkg.contains?.[shop.currency_item_id] > 0,
        )
    );
}

/**
 * Every item the plan gets from the event: the bought packs' contents (incl. the picked choice options), the shop
 * offers bought and the bonus tiers reached, the Encounters' expected rewards (bought and free) minus what they cost
 * (diamonds), and the mine's expected loot,
 * wishes and progress rewards (`dug`: the mine's entry of the plan, if any). The shop's coins and the mine's
 * pickaxes are left out (they're spent there). Sorted by worth.
 * `partsOf(pkg)`: the item parts of a package (`{ id, qty }`), `worthOf(id)`: Banknote worth of one unit or null.
 * Returns `[{ id, qty, worth }]`.
 */
function eventItemTotals(plan, { eventId, shopId, shop, mine, dug }, { partsOf, worthOf }) {
    const totals = new Map();
    const add = (id, qty) => totals.set(id, (totals.get(id) || 0) + qty);
    if (eventId) {
        for (const p of eventPurchases(plan, eventId)) {
            for (const part of partsOf(p.pkg)) {
                add(part.id, part.qty * p.count);
            }
        }
    }
    if (shop) {
        for (const e of plan.exchanges.filter((x) => x.shopId === shopId)) {
            add(e.offer.item_id, e.offer.quantity * e.count);
        }
        for (const tier of plan.tiersReached.filter((x) => x.shopId === shopId)) {
            for (const [id, qty] of Object.entries(tier.reward)) {
                add(id, qty);
            }
        }
        const pointPurchase = plan.pointPurchases.find((p) => p.shopId === shopId);
        if (shop.point_purchase && pointPurchase) {
            add(shop.point_purchase.currency_item_id, -pointPurchase.count * shop.point_purchase.currency_cost);
            for (const [id, qty] of Object.entries(expectedRolls(shop.point_purchase.rolls))) {
                add(id, qty * (pointPurchase.count + (pointPurchase.free || 0)));
            }
        }
        totals.delete(shop.currency_item_id);
    }
    if (mine && dug) {
        const bundles = [
            dug.normalRewards,
            ...dug.wishes.flatMap(({ reward, count }) =>
                count > 0 ? [Object.fromEntries(Object.entries(reward).map(([id, qty]) => [id, qty * count]))] : [],
            ),
            ...dug.progressReached.map((floor) => mine.progress_rewards[String(floor)]),
        ];
        for (const bundle of bundles) {
            for (const [id, qty] of Object.entries(bundle)) {
                add(id, qty);
            }
        }
        totals.delete(mine.currency_item_id);
    }
    return [...totals]
        .filter(([, qty]) => Math.abs(qty) > 1e-9)
        .map(([id, qty]) => ({ id, qty, worth: qty * (worthOf(id) ?? 0) }))
        .sort((a, b) => b.worth - a.worth);
}

/**
 * The locks (`lockedOffers`: "<shopId>:<offerKey>" -> count) with this offer's changed: `count` null = unlock, 0 =
 * never buy, otherwise exactly that many per week. Returns a new object.
 */
function withLock(lockedOffers, shopId, offerKey, count) {
    const next = { ...lockedOffers };
    const key = `${shopId}:${offerKey}`;
    if (count === null) {
        delete next[key];
    } else {
        next[key] = count;
    }
    return next;
}

/** The locks without those of shop `shopId`. Returns a new object. */
function withoutShopLocks(lockedOffers, shopId) {
    return Object.fromEntries(Object.entries(lockedOffers || {}).filter(([key]) => key.split(':')[0] !== shopId));
}

/**
 * Banknotes of the weekly spend the locks take from everything outside the event's packs: what the `baseline` plan
 * (the event left alone: without the locks and the event's extra Banknotes) spends there minus what the `locked` plan
 * does, at least 0. The event's extra Banknotes never pay for anything else, so setting that much extra for the event
 * gives the other purchases their spend back.
 */
function lockSpendGap(locked, baseline, eventId) {
    const outside = (plan) => plan.spent - eventPackSpend(plan, eventId);
    return Math.max(0, outside(baseline) - outside(locked));
}

// Rounds of raising the extra by the gap that is left (see `extraToLeaveAlone`) before the figure is taken as it is.
const MAX_EXTRA_ROUNDS = 4;

/**
 * The extra Banknotes for the event that give the other packs their spend back: the locked offers' packs paid from
 * them. A plan only buys as many fixed offers as its money allows, so the gap (`lockSpendGap`) of the plan at the extra
 * the user set (`current`, at `extra`) is only the part of what the locks need that this money has shown so far.
 * Raising the extra by that gap and solving again (`solve(extra)`: the plan with that extra for the event), until none
 * is left, never overshoots (an extra Banknote frees at most one of the weekly spend) and ends at the same figure
 * whatever extra the user started from. The extra stops at `maxExtra` (the most the event's packs can take: more
 * can't be spent, and the plans with huge extras are the slow ones to solve).
 * Returns `{ taken, needed }`: what `current` takes from the other packs, and the total extra that leaves them alone
 * (`extra` itself if `current` takes nothing).
 */
function extraToLeaveAlone({ eventId, baseline, current, extra, maxExtra = Infinity, solve }) {
    const taken = lockSpendGap(current, baseline, eventId);
    let needed = extra;
    let gap = taken;
    for (let round = 0; round < MAX_EXTRA_ROUNDS && gap >= 1 && needed < maxExtra; round++) {
        needed = Math.min(needed + gap, maxExtra);
        gap = lockSpendGap(solve(needed), baseline, eventId);
    }
    return { taken, needed: Math.min(needed + gap, maxExtra) };
}

/**
 * What one purchase of a shop offer costs in Banknotes: the worth the weekly plan gives up elsewhere for it (the coins
 * of other offers, more or fewer packs, bonus tiers, unlocks), found by solving the plan again with only this offer's
 * lock changed:
 * - the plan doesn't buy it: the price of one more purchase (`solve` with it fixed at 1);
 * - the plan buys it: the price of its last purchase (`solve` with it fixed one lower), what the plan would get back
 *   without it, so a bought offer's price stays below its worth.
 * `plan` is the weekly plan (`lockedOffers` the locks it was solved with), `offerWorth` the Banknote worth of one
 * purchase's item, `capacity` the offer's purchases per week and `solve(lockedOffers)` the plan solved again with those
 * locks (it may throw, e.g. out of time).
 * Returns `{ banknotes, last }` (`last`: the price of the last purchase the plan makes), `{ outOfReach: true }` if
 * the spend can't fit one more purchase, or null if the plan has no Banknote rate to price in.
 */
function offerPurchaseCost({ plan, shopId, offerKey, offerWorth, capacity, lockedOffers, solve }) {
    if (!(plan.rate > 0)) {
        return null;
    }
    const bought = Math.round(plan.exchanges.find((x) => x.shopId === shopId && x.offerKey === offerKey)?.count ?? 0);
    const last = bought > 0;
    if (!last && !(capacity > 0)) {
        return { outOfReach: true };
    }
    const next = solve(withLock(lockedOffers, shopId, offerKey, last ? bought - 1 : 1));
    if (!last && next.lockShortfalls.some((shortfall) => shortfall.key === `${shopId}:${offerKey}`)) {
        return { outOfReach: true };
    }
    // What the plan loses by the change (the plan is the best one, so never below 0 but for rounding).
    const loss = (plan.totalPoints - next.totalPoints) / plan.rate;
    return { banknotes: Math.max(0, last ? offerWorth - loss : offerWorth + loss), last };
}

/** The lock keys that count: those of a shop that exists and is either without event or of an event on. */
function activeLocks(lockedOffers, shops, activeEvents) {
    return Object.keys(lockedOffers || {}).filter((key) => {
        const shop = shops[key.split(':')[0]];
        return shop && (!shop.event_id || activeEvents.includes(shop.event_id));
    });
}

/**
 * The currency the user can enter an amount of from outside the packs for a shop: its coin (see
 * `hasOutsideCurrency`), or the extra diamonds the user adds to spend on its Encounters (`point_purchase`).
 * Null if there is none.
 */
function outsideCurrencyId(packages, shop) {
    if (hasOutsideCurrency(packages, shop)) {
        return shop.currency_item_id;
    }
    return shop?.point_purchase?.currency_item_id ?? null;
}

/**
 * The progress points (bonus tiers, offer unlocks) the plan earns in a shop, by where they come from: the
 * Encounters (bought and free, `point_purchase`) and the coins spent on its offers (`points_per_currency` each).
 * Returns `{ encounters, spent, total }`.
 */
function shopProgress(plan, shopId, shop) {
    const pointPurchase = plan.pointPurchases.find((p) => p.shopId === shopId);
    const encounters = shop.point_purchase
        ? ((pointPurchase?.count || 0) + (pointPurchase?.free || 0)) * shop.point_purchase.points
        : 0;
    const spent = plan.exchanges
        .filter((x) => x.shopId === shopId)
        .reduce((sum, x) => sum + x.count * x.offer.currency_cost * (shop.points_per_currency ?? 1), 0);
    return { encounters, spent, total: encounters + spent };
}

export {
    activeLocks,
    eventItemTotals,
    eventSelection,
    extraToLeaveAlone,
    hasOutsideCurrency,
    lockSpendGap,
    offerPurchaseCost,
    outsideCurrencyId,
    shopProgress,
    withLock,
    withoutShopLocks,
};

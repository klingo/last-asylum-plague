/**
 * What the Event Shops page reads from the data and the weekly plan about one event: which event (and its shop and
 * mine) a tab stands for, whether the shop's currency also comes from outside the packs, and every item the plan
 * gets from the event.
 *
 * Pure module (no DOM/i18n), shared with the tests.
 */
import { eventPurchases } from './step-analysis.js';

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
 * offers bought and the bonus tiers reached, minus what Encounters cost (diamonds), and the mine's expected loot,
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

/** The lock keys that count: those of a shop that exists and is either without event or of an event on. */
function activeLocks(lockedOffers, shops, activeEvents) {
    return Object.keys(lockedOffers || {}).filter((key) => {
        const shop = shops[key.split(':')[0]];
        return shop && (!shop.event_id || activeEvents.includes(shop.event_id));
    });
}

export { activeLocks, eventItemTotals, eventSelection, hasOutsideCurrency, withLock };

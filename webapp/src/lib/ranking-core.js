/**
 * Browser-safe port of scripts/build-item-value-index.js + scripts/rank-packages.js,
 * computed live from the raw pack data (no pre-generated output/*.json files involved).
 * Ranks every package AND every exchange shop offer (including bonus tiers) by how much
 * value they provide relative to their price, using each item's cheapest known Banknotes
 * cost (see lib/pricing-core.js `createMarket`).
 *
 * "Value" of a purchase option is the sum of (quantity * item.unit_cost) for every item it
 * contains. For "choice" blocks (pick N of several options), the best N choices are assumed,
 * matching the optimistic approach the item-analysis page already uses for yield
 * calculations. "value_ratio" (value / price) is the ranking metric: options that return
 * more value per Banknote spent rank higher, i.e. they are the best deals to prioritize
 * buying. Purchase limits are intentionally ignored for this "unit cost" (a fresh market is
 * peeked, never purchased from), since it represents the theoretical cheapest market price
 * of an item, independent of how many can actually be bought.
 *
 * A package/bonus tier is never allowed to count as evidence for its own contents' worth: for
 * each one, its contents are priced against a market built with THAT ONE bundle excluded (see
 * `marketExcludingPackage`/`marketExcludingBonusTier`) — reusing `createMarket` entirely
 * unchanged, just called with a filtered input. If an item still has no OTHER known source
 * anywhere (only ever sold as part of this exact bundle), it can't be priced independently;
 * rather than crediting it with the bundle's entire price (which would make e.g. a
 * 9999-Banknote bundle handing over six different items read as "each of those six items
 * individually costs 9999"), whatever price is left over after paying the bundle's OTHER
 * contents their real market rate is split evenly across those exclusive items (`valueOfBundle`).
 * If the resolvable contents alone already account for the full price, exclusive items get 0
 * — there's no room left in the price to attribute to them. This computation is entirely
 * local to each bundle (no bundle's valuation depends on any other bundle's OUTPUT), so unlike
 * a globally self-consistent solve there's no possibility of cross-bundle feedback loops or
 * numerical instability; the trade-off is that items exclusive to more than one otherwise-poorly-
 * connected bundle are priced independently per bundle rather than reconciled against each other.
 */

import { createMarket, packageDisplayName } from './pricing-core';
import { localizedName, t } from './i18n';
import { formatThousands } from './format';

function getUnitCost(market, itemId) {
    const cost = market.peekUnitCost(itemId);
    return Number.isFinite(cost) ? cost : null;
}

// A market that never considers `excludePkgId` a package source, so that package can never be
// counted as evidence for its own contents' worth. Reuses `createMarket` unchanged.
function marketExcludingPackage(packages, exchangeShops, items, locale, excludePkgId) {
    if (!excludePkgId || !(excludePkgId in packages)) {
        return createMarket(packages, exchangeShops, items, {}, {}, locale);
    }
    const filteredPackages = { ...packages };
    delete filteredPackages[excludePkgId];
    return createMarket(filteredPackages, exchangeShops, items, {}, {}, locale);
}

// Same idea for one specific bonus tier: keeps its shop's offers and every other tier intact,
// drops just that one threshold.
function marketExcludingBonusTier(packages, exchangeShops, items, locale, excludeShopId, excludeThresholdStr) {
    const filteredExchangeShops = {};
    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        if (shopId !== excludeShopId || !shop.bonus_tiers || !(excludeThresholdStr in shop.bonus_tiers)) {
            filteredExchangeShops[shopId] = shop;
            continue;
        }
        const filteredBonusTiers = { ...shop.bonus_tiers };
        delete filteredBonusTiers[excludeThresholdStr];
        filteredExchangeShops[shopId] = { ...shop, bonus_tiers: filteredBonusTiers };
    }
    return createMarket(packages, filteredExchangeShops, items, {}, {}, locale);
}

/**
 * Values a flat `{itemId: qty}` map against `price`, pricing each item via `excludingMarket`
 * (see module header). See module header for the exclusive-item residual-split rule.
 *
 * Any item in `excludeItemIds` is still priced (informationally) and still gets its own
 * breakdown row, but always contributes 0 to `total` and never enters the exclusive-item
 * residual split — it's a deliberate opt-out from the value calculation, not a missing price,
 * so it doesn't affect `complete` either.
 */
function valueOfBundle(contentsMap, price, excludingMarket, items, locale, excludeItemIds) {
    const resolvable = [];
    const exclusive = [];
    const excluded = [];

    for (const [itemId, qty] of contentsMap) {
        if (excludeItemIds?.has(itemId)) {
            excluded.push({ itemId, qty });
            continue;
        }
        const unitCost = getUnitCost(excludingMarket, itemId);
        if (unitCost === null) {
            exclusive.push({ itemId, qty });
        } else {
            resolvable.push({ itemId, qty, unitCost });
        }
    }

    let total = 0;
    const breakdown = [];
    for (const { itemId, qty, unitCost } of resolvable) {
        const value = qty * unitCost;
        total += value;
        breakdown.push({
            item_id: itemId,
            name: localizedName(items[itemId]?.name, locale) || itemId,
            quantity: qty,
            unit_cost: unitCost,
            value: Number(value.toFixed(6)),
            known: true,
        });
    }

    if (exclusive.length > 0) {
        const residual = Math.max(0, price - total);
        const perItemShare = residual / exclusive.length;
        for (const { itemId, qty } of exclusive) {
            total += perItemShare;
            breakdown.push({
                item_id: itemId,
                name: localizedName(items[itemId]?.name, locale) || itemId,
                quantity: qty,
                unit_cost: perItemShare / qty,
                value: Number(perItemShare.toFixed(6)),
                known: false,
            });
        }
    }

    for (const { itemId, qty } of excluded) {
        const unitCost = getUnitCost(excludingMarket, itemId);
        breakdown.push({
            item_id: itemId,
            name: localizedName(items[itemId]?.name, locale) || itemId,
            quantity: qty,
            unit_cost: unitCost,
            value: 0,
            known: true,
        });
    }

    return { total, complete: exclusive.length === 0, breakdown };
}

/**
 * A package's own directly-declared contents: `contains` plus whichever `choice` branch(es)
 * currently look best (top `select_count`), priced via `excludingMarket`. Matches the
 * optimistic "assume the best choices" approach the item-analysis page already uses.
 */
function mergedContentsOf(pkg, excludingMarket) {
    const merged = new Map();
    const add = (id, qty) => merged.set(id, (merged.get(id) || 0) + qty);

    if (pkg.contains) {
        for (const [id, qty] of Object.entries(pkg.contains)) add(id, qty);
    }
    if (pkg.choice?.choices?.length) {
        const selectCount = pkg.choice.select_count || 1;
        const scored = pkg.choice.choices
            .map((choiceEntry) => {
                let total = 0;
                for (const [id, qty] of Object.entries(choiceEntry)) {
                    const v = getUnitCost(excludingMarket, id);
                    total += v !== null ? qty * v : 0;
                }
                return { choiceEntry, total };
            })
            .sort((a, b) => b.total - a.total);
        for (const { choiceEntry } of scored.slice(0, selectCount)) {
            for (const [id, qty] of Object.entries(choiceEntry)) add(id, qty);
        }
    }
    return merged;
}

// ---- Bundle-aware ("fair") pricing ---------------------------------------------------------
// This is how the Value Ranking page prices every package/bonus-tier's own contents — a
// self-contained algorithm, local to this file, that never touches pricing-core.js's
// `createMarket`/`peekUnitCost` (reused here unchanged only as an input — see `naiveMarket`
// below), so Analyze/Purchase Plan/Choices are entirely unaffected by it.
//
// The problem: `peekUnitCost` prices an item as `min(package.price / thatItem'sYieldFromPackage)`
// across every package yielding it — i.e. it credits a package's ENTIRE price to a single item
// it hands over, ignoring everything else that same purchase also gives you. That's a fine
// approximation for a package that's essentially "one item + filler," but badly over-prices a
// genuine multi-item bundle whenever it's used as a comparison source for pricing just ONE of
// its own components: e.g. a 1999-Banknote pass bundling 6 different rewards makes each of
// those rewards look like it alone costs up to 1999, wildly inflating the computed value of any
// narrower single-item package selling one of the same rewards.
//
// The fix: apportion each bundle's price across everything it hands over, crediting an item
// only with the LEFTOVER price after paying for the bundle's other contents at THEIR own
// already-settled rate — the same "residual" principle `valueOfBundle` already uses for items
// with no other source at all, generalized here into the market-pricing step itself.
//
// Doing this correctly requires an item to only ever be priced via a bundle once every OTHER
// item that bundle also yields already has a final, settled price — otherwise the residual is
// just a guess that could later turn out to have been computed from incomplete information,
// with no way to retract it (an earlier iterative-refinement version of this function had
// exactly that bug: an early low-quality estimate could never be un-set once something better
// was learned later). So this resolves items with a Dijkstra-style greedy solve: repeatedly
// settle whichever not-yet-settled item currently has the cheapest available candidate price,
// where a bundle only OFFERS a candidate for its one remaining unsettled item once every other
// item it contains has already been settled. Every settlement is therefore final the moment
// it's made (same optimality argument as Dijkstra's shortest path: every not-yet-settled
// candidate is bounded below by the current settlement frontier, so nothing settled so far can
// ever be undercut later) — one pass, no iteration count or processing order to reason about.
//
// A bundle whose OTHER contents, at their settled rate, already account for its entire price
// contributes NO usable candidate for whatever's left (a non-positive residual isn't "free," it
// just means this bundle is uninformative about that item's price) — so that item simply stays
// unsettled unless some OTHER bundle prices it fairly, which then correctly falls through to
// `valueOfBundle`'s existing "exclusive item" residual-split when it's later valued.
//
// Only "pure" bundles participate as pricing sources: exchange offers (always exactly one
// declared item type per offer) and `contains`-only packages/bonus tiers. Packages with a
// `choice` block are deliberately excluded from being a pricing SOURCE for other items — which
// option(s) they'd yield depends on prices that are themselves still being solved for, a
// circularity not worth taking on for the small fraction of packages that use `choice`; they're
// still valued normally (via `mergedContentsOf`/`valueOfBundle`) against whatever this
// produces, same as any other package.

// Wraps a plain `{itemId: price}` Map as a minimal market-like object, so the existing
// `getUnitCost`/`mergedContentsOf` helpers can consume a fair-price snapshot exactly like a
// real `createMarket()` market, without needing a second, parallel set of helpers.
function priceMapAsMarket(priceMap) {
    return {
        peekUnitCost: (itemId) => {
            const v = priceMap.get(itemId);
            return Number.isFinite(v) ? v : NaN;
        },
    };
}

/**
 * Computes a bundle-aware "fair" per-item price snapshot via the Dijkstra-style solve described
 * above. `exclude` (optional `{ packageId }` or `{ shopId, thresholdStr }`) drops one specific
 * bundle from participating at all, mirroring `marketExcludingPackage`/`marketExcludingBonusTier`'s
 * self-reference guard: a bundle is never allowed to count as evidence for its own worth. Pass
 * `null` for a shared, nothing-excluded snapshot (e.g. for exchange offers, which never
 * self-reference anything).
 */
function buildFairPriceMap(packages, exchangeShops, items, locale, exclude = null) {
    // Same self-exclusion as the naive algorithm; used both for exchange-offer currency
    // conversion below AND as the naive-price fallback for anything the strict Dijkstra solve
    // below can never fire a candidate for (see the fallback loop at the end of this function).
    const naiveMarket = exclude?.packageId
        ? marketExcludingPackage(packages, exchangeShops, items, locale, exclude.packageId)
        : exclude?.shopId
          ? marketExcludingBonusTier(packages, exchangeShops, items, locale, exclude.shopId, exclude.thresholdStr)
          : createMarket(packages, exchangeShops, items, {}, {}, locale);

    // Every candidate bundle this solve can draw on: `{ price, contents: Map<itemId, qty> }`.
    const bundles = [];

    for (const [pkgId, pkg] of Object.entries(packages)) {
        if (exclude?.packageId === pkgId || pkg.choice || !pkg.contains) {
            continue;
        }
        if (!Number.isFinite(pkg.price) || pkg.price <= 0) {
            continue;
        }
        bundles.push({ price: pkg.price, contents: new Map(Object.entries(pkg.contains)) });
    }

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = naiveMarket.peekUnitCost(shop.currency_item_id);
        if (!Number.isFinite(currencyUnitCost)) {
            continue;
        }

        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const offerItemId = offer.item_id || offerKey;
            const offerPrice = offer.currency_cost * currencyUnitCost;
            if (!Number.isFinite(offerPrice) || offerPrice <= 0 || !(offer.quantity > 0)) {
                continue;
            }
            bundles.push({ price: offerPrice, contents: new Map([[offerItemId, offer.quantity]]) });
        }

        for (const [thresholdStr, contains] of Object.entries(shop.bonus_tiers || {})) {
            if (exclude?.shopId === shopId && exclude.thresholdStr === thresholdStr) {
                continue;
            }
            const bundlePrice = Number(thresholdStr) * currencyUnitCost;
            if (!Number.isFinite(bundlePrice) || bundlePrice <= 0) {
                continue;
            }
            bundles.push({ price: bundlePrice, contents: new Map(Object.entries(contains)) });
        }
    }

    // Every bundle a given item participates in, for both firing decisions (see
    // `exhaustGenuineSettlements`) and the fallback-priority ordering below.
    const bundleIndexesByItem = new Map();
    for (let i = 0; i < bundles.length; i++) {
        for (const itemId of bundles[i].contents.keys()) {
            if (!bundleIndexesByItem.has(itemId)) {
                bundleIndexesByItem.set(itemId, []);
            }
            bundleIndexesByItem.get(itemId).push(i);
        }
    }

    const settled = new Map();

    // Items some bundle actually got to make a residual determination for at some point,
    // whether or not that residual was positive — see the fallback loop below. Once fully
    // interleaved with the fallback fills (see below), a rejection recorded here reflects a
    // determination made against fully-settled sibling prices, not a premature one — that's
    // what distinguishes "every real source for this item turned out uninformative" (a
    // deliberate finding: don't paper over it with the naive price, that's the exact distortion
    // this whole algorithm exists to fix) from "nothing has priced this at all yet."
    const attempted = new Set();

    // Runs the strict Dijkstra solve — using ONLY genuine, bundle-derived candidates, never the
    // naive fallback below — to full exhaustion against the CURRENT `settled` snapshot. A
    // bundle offers a candidate for its one remaining unsettled item once every OTHER item it
    // contains is settled; a non-positive residual means that bundle is uninformative for that
    // item (not "free" — see module header) and simply offers nothing. Safe to call repeatedly
    // as `settled` grows (e.g. after a single naive fallback fill below): recomputes pending
    // counts from scratch each time rather than relying on incremental bookkeeping, so there's
    // no risk of missing a bundle that only became fireable because of a just-added price.
    function exhaustGenuineSettlements() {
        let progress = true;
        while (progress) {
            progress = false;
            const frontier = new Map();

            for (const { price: bundlePrice, contents } of bundles) {
                let otherValue = 0;
                let remainingItemId = null;
                let remainingQty = 0;
                let unsettledCount = 0;
                for (const [itemId, qty] of contents) {
                    if (settled.has(itemId)) {
                        otherValue += qty * settled.get(itemId);
                    } else {
                        unsettledCount++;
                        remainingItemId = itemId;
                        remainingQty = qty;
                    }
                }
                if (unsettledCount !== 1 || remainingQty <= 0) {
                    continue;
                }
                attempted.add(remainingItemId);
                const residual = bundlePrice - otherValue;
                if (residual > 0) {
                    const candidate = residual / remainingQty;
                    if (candidate < (frontier.get(remainingItemId) ?? Infinity)) {
                        frontier.set(remainingItemId, candidate);
                    }
                }
            }

            while (frontier.size > 0) {
                let bestItemId = null;
                let bestPrice = Infinity;
                for (const [itemId, candidatePrice] of frontier) {
                    if (candidatePrice < bestPrice) {
                        bestPrice = candidatePrice;
                        bestItemId = itemId;
                    }
                }
                frontier.delete(bestItemId);
                settled.set(bestItemId, bestPrice);
                progress = true;
            }
        }
    }

    exhaustGenuineSettlements();

    // Anything still unsettled here is permanently stuck: no bundle containing it can EVER
    // reach "exactly one unsettled item" without outside help, because at least one of its
    // bundle-mates is ALSO stuck (this dataset leans heavily on multi-item bundles with no
    // clean single-item anchor even for near-universal items like diamonds, so that's common,
    // not a rare edge case). Left alone, this is what made every package containing such an
    // item show value_ratio 1.0000 — `valueOfBundle`'s residual-split swallows the bundle's
    // ENTIRE price the moment even one content item has no price at all.
    //
    // Break the deadlock one item at a time, filling in its naive per-item price (same
    // self-exclusion as the naive algorithm) purely to unblock bundles waiting on it — then
    // re-running the exhaustive solve before touching anything else, so any bundle that can
    // NOW make a genuine, correctly-informed determination (including a legitimate rejection)
    // gets to do so before a less-central item's naive fallback would otherwise preempt it.
    // Processing in descending bundle-membership order tackles the most-blocking items
    // (diamonds, VIP points, alliance chests, ...) first, which is what lets e.g. a combined
    // pass's individual-item siblings settle genuinely off of a fallback-priced "diamonds"
    // instead of the combined pass itself ever needing a naive fallback of its own.
    const stuckByConnectivity = [...bundleIndexesByItem.keys()]
        .filter((itemId) => !settled.has(itemId))
        .sort((a, b) => bundleIndexesByItem.get(b).length - bundleIndexesByItem.get(a).length);

    for (const itemId of stuckByConnectivity) {
        if (settled.has(itemId)) {
            continue; // resolved genuinely as a side effect of an earlier fallback fill's ripple
        }
        if (attempted.has(itemId)) {
            // Some bundle already made a genuine (fully-informed, since it only just became
            // fireable through the fallback fills processed so far) rejection for this item —
            // respect it rather than silently overriding with the naive price.
            continue;
        }
        const naive = naiveMarket.peekUnitCost(itemId);
        if (!Number.isFinite(naive)) {
            continue;
        }
        settled.set(itemId, naive);
        exhaustGenuineSettlements();
    }

    return settled;
}

function rankPackages(packages, fairPricingExchangeShops, items, locale, excludeItemIds) {
    const rankings = [];

    for (const [pkgId, pkg] of Object.entries(packages)) {
        const price = pkg.price;
        if (!Number.isFinite(price) || price <= 0) {
            continue;
        }

        const excludingMarket = priceMapAsMarket(
            buildFairPriceMap(packages, fairPricingExchangeShops, items, locale, { packageId: pkgId }),
        );
        const merged = mergedContentsOf(pkg, excludingMarket);
        const { total, complete, breakdown } = valueOfBundle(
            merged,
            price,
            excludingMarket,
            items,
            locale,
            excludeItemIds,
        );

        rankings.push({
            type: 'package',
            id: pkgId,
            name: packageDisplayName(pkg, locale),
            category: pkg.category || '-',
            price,
            price_display: t('rankings.priceDisplay.package', {
                price: formatThousands(price),
                currency: t('currency.banknotes'),
            }),
            total_value: Number(total.toFixed(2)),
            value_ratio: Number((total / price).toFixed(4)),
            purchase_limit: pkg.purchase_limit,
            limit_type: pkg.limit_type,
            available_days: pkg.available_days || null,
            requires: pkg.requires || null,
            value_complete: complete,
            contains_breakdown: breakdown,
        });
    }

    return rankings;
}

function rankExchangeOffers(exchangeShops, market, currencyMarket, items, locale, excludeItemIds) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(currencyMarket, shop.currency_item_id);

        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const offerItemId = offer.item_id || offerKey;
            const isExcluded = excludeItemIds?.has(offerItemId) ?? false;
            // No self-exclusion here: an offer only ever hands over one declared item type, so
            // there's no bundling ambiguity to game — see module header.
            const unitCost = getUnitCost(market, offerItemId);

            const totalValue = isExcluded ? 0 : offer.quantity * (unitCost ?? 0);
            const price = offer.currency_cost * (currencyUnitCost ?? NaN);
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            const currencyName = localizedName(items[shop.currency_item_id]?.name, locale) || shop.currency_item_id;

            rankings.push({
                type: 'exchange_offer',
                id: `${shopId}:${offerKey}`,
                name: `${localizedName(shop.name, locale)} - ${localizedName(items[offerItemId]?.name, locale) || offerItemId}`,
                category: shop.category || (shop.event_id ? 'event_exchange' : 'exchange'),
                price: Number(price.toFixed(6)),
                price_display: t('rankings.priceDisplay.exchange', {
                    cost: formatThousands(offer.currency_cost),
                    currencyName,
                    approx: formatThousands(Number(price.toFixed(2))),
                    currency: t('currency.banknotes'),
                }),
                total_value: Number(totalValue.toFixed(2)),
                value_ratio: Number((totalValue / price).toFixed(4)),
                purchase_limit: offer.purchase_limit,
                limit_type: offer.limit_type,
                available_days: null,
                requires: null,
                value_complete: (isExcluded || unitCost !== null) && currencyUnitCost !== null,
                contains_breakdown: [
                    {
                        item_id: offerItemId,
                        name: localizedName(items[offerItemId]?.name, locale) || offerItemId,
                        quantity: offer.quantity,
                        unit_cost: unitCost,
                        value: isExcluded ? 0 : unitCost !== null ? Number(totalValue.toFixed(6)) : 0,
                        known: isExcluded || unitCost !== null,
                    },
                ],
            });
        }
    }

    return rankings;
}

function rankBonusTiers(
    packages,
    exchangeShops,
    fairPricingExchangeShops,
    currencyMarket,
    items,
    locale,
    excludeItemIds,
) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(currencyMarket, shop.currency_item_id);

        for (const [thresholdStr, contains] of Object.entries(shop.bonus_tiers || {})) {
            const threshold = Number(thresholdStr);
            if (!Number.isFinite(threshold) || threshold <= 0) {
                continue;
            }

            const price = threshold * (currencyUnitCost ?? NaN);
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            const excludingMarket = priceMapAsMarket(
                buildFairPriceMap(packages, fairPricingExchangeShops, items, locale, { shopId, thresholdStr }),
            );
            const { total, complete, breakdown } = valueOfBundle(
                new Map(Object.entries(contains)),
                price,
                excludingMarket,
                items,
                locale,
                excludeItemIds,
            );

            const currencyName = localizedName(items[shop.currency_item_id]?.name, locale) || shop.currency_item_id;

            rankings.push({
                type: 'bonus_tier',
                id: `${shopId}:bonus_tier_${thresholdStr}`,
                name: `${localizedName(shop.name, locale)} - ${t('sourceType.bonus_tier')} (${thresholdStr} ${currencyName})`,
                category: shop.category || (shop.event_id ? 'event_exchange' : 'exchange'),
                price: Number(price.toFixed(6)),
                price_display: t('rankings.priceDisplay.bonusTier', {
                    threshold: formatThousands(threshold),
                    currencyName,
                    approx: formatThousands(Number(price.toFixed(2))),
                    currency: t('currency.banknotes'),
                }),
                total_value: Number(total.toFixed(2)),
                value_ratio: Number((total / price).toFixed(4)),
                purchase_limit: 1,
                limit_type: 'cumulative_spend',
                available_days: null,
                requires: null,
                value_complete: complete && currencyUnitCost !== null,
                contains_breakdown: breakdown,
            });
        }
    }

    return rankings;
}

/**
 * Builds the full live ranking of packages/exchange offers/bonus tiers from raw pack data.
 * Mirrors the shape of the (now retired) output/value_ranking.json for a drop-in swap.
 *
 * `options.excludeExchangeShops`, when true, drops exchange shops entirely: neither the price
 * market nor the value attribution consider exchange offers as a source (so package "value" is
 * computed from packages alone), and exchange offer / bonus tier entries — both inherently
 * shop-based — are left out of the rankings altogether rather than kept around with a
 * now-pointless price.
 *
 * `options.excludeItemIds`, when given, zeroes out those item ids' contribution to every
 * bundle's value/ratio computation (see `valueOfBundle`) — e.g. near-universal filler
 * currencies that would otherwise pad every package's value regardless of its actual unique
 * rewards. They still get their own `contains_breakdown` row (with `value: 0`, so the item
 * stays visible rather than silently vanishing from the breakdown) and are still priced
 * informationally wherever something else needs their cost (e.g. a shop's currency); only their
 * contribution to the bundle's own total is suppressed.
 *
 * Every package/bonus-tier's own contents are priced via `buildFairPriceMap` (see that
 * function's header), not pricing-core.js's naive per-item market. That solve always draws on
 * the FULL exchange-shop data as pricing evidence regardless of `excludeExchangeShops`, even
 * though excluded shops' own offers/bonus tiers still won't appear as their own ranked rows —
 * unlike a naive per-item market (which always finds SOME package-only price for nearly
 * anything), the fair solve needs a bundle's every OTHER item to be fully settled before it can
 * price the last one, so a sparser graph with exchange shops removed leaves most items unable
 * to settle at all; since ANY unsettled item in a bundle makes `valueOfBundle`'s residual-split
 * force that bundle's total to exactly equal its price, a sparser graph would otherwise turn
 * into every single package showing value_ratio 1.0000.
 */
function buildRanking(data, locale = 'en', options = {}) {
    const { excludeExchangeShops = false, excludeItemIds = null } = options;
    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = excludeExchangeShops ? {} : data.exchange_shops || {};
    const fairPricingExchangeShops = data.exchange_shops || {};
    // Shop currencies are always converted via the plain (naive) market — a currency that's
    // itself only sold as part of a multi-item bundle can otherwise fail to settle under the
    // stricter fair-pricing solve (see `buildFairPriceMap`'s header), which would wipe out every
    // offer/bonus tier priced in that currency rather than just making their VALUE fair. Only
    // what a bundle/offer *hands you* gets fair pricing.
    const currencyMarket = createMarket(packages, exchangeShops, items, {}, {}, locale);
    const market = priceMapAsMarket(buildFairPriceMap(packages, fairPricingExchangeShops, items, locale, null));

    const rankings = [
        ...rankPackages(packages, fairPricingExchangeShops, items, locale, excludeItemIds),
        ...rankExchangeOffers(exchangeShops, market, currencyMarket, items, locale, excludeItemIds),
        ...rankBonusTiers(
            packages,
            exchangeShops,
            fairPricingExchangeShops,
            currencyMarket,
            items,
            locale,
            excludeItemIds,
        ),
    ]
        .filter((entry) => Number.isFinite(entry.value_ratio))
        .sort((a, b) => b.value_ratio - a.value_ratio)
        .map((entry, index) => ({ rank: index + 1, ...entry }));

    return {
        metadata: {
            generated_at: new Date().toISOString(),
            source_last_updated: data.metadata?.last_updated || null,
            currency: data.metadata?.currency || t('currency.banknotes'),
            entry_count: rankings.length,
            note: t('rankings.note'),
        },
        rankings,
    };
}

export { buildRanking };

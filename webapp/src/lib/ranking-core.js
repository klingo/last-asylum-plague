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
 */
function valueOfBundle(contentsMap, price, excludingMarket, items, locale) {
    const resolvable = [];
    const exclusive = [];

    for (const [itemId, qty] of contentsMap) {
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

// Drops any `excludeItemIds` entries from a contents map before it reaches `valueOfBundle`,
// so those items neither contribute to the bundle's total value nor soak up any of the
// unknown-item residual split (see module header). An empty map after filtering means the
// bundle has nothing left to rank.
function withoutExcludedItems(contentsMap, excludeItemIds) {
    if (!excludeItemIds || excludeItemIds.size === 0) {
        return contentsMap;
    }
    const filtered = new Map();
    for (const [itemId, qty] of contentsMap) {
        if (!excludeItemIds.has(itemId)) {
            filtered.set(itemId, qty);
        }
    }
    return filtered;
}

function rankPackages(packages, exchangeShops, items, locale, excludeItemIds) {
    const rankings = [];

    for (const [pkgId, pkg] of Object.entries(packages)) {
        const price = pkg.price;
        if (!Number.isFinite(price) || price <= 0) {
            continue;
        }

        const excludingMarket = marketExcludingPackage(packages, exchangeShops, items, locale, pkgId);
        const merged = withoutExcludedItems(mergedContentsOf(pkg, excludingMarket), excludeItemIds);
        if (merged.size === 0) {
            continue;
        }
        const { total, complete, breakdown } = valueOfBundle(merged, price, excludingMarket, items, locale);

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

function rankExchangeOffers(exchangeShops, market, items, locale, excludeItemIds) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(market, shop.currency_item_id);

        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const offerItemId = offer.item_id || offerKey;
            if (excludeItemIds?.has(offerItemId)) {
                continue;
            }
            // No self-exclusion here: an offer only ever hands over one declared item type, so
            // there's no bundling ambiguity to game — see module header.
            const unitCost = getUnitCost(market, offerItemId);

            const totalValue = offer.quantity * (unitCost ?? 0);
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
                value_complete: unitCost !== null && currencyUnitCost !== null,
                contains_breakdown: [
                    {
                        item_id: offerItemId,
                        name: localizedName(items[offerItemId]?.name, locale) || offerItemId,
                        quantity: offer.quantity,
                        unit_cost: unitCost,
                        value: unitCost !== null ? Number(totalValue.toFixed(6)) : 0,
                        known: unitCost !== null,
                    },
                ],
            });
        }
    }

    return rankings;
}

function rankBonusTiers(packages, exchangeShops, market, items, locale, excludeItemIds) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(market, shop.currency_item_id);

        for (const [thresholdStr, contains] of Object.entries(shop.bonus_tiers || {})) {
            const threshold = Number(thresholdStr);
            if (!Number.isFinite(threshold) || threshold <= 0) {
                continue;
            }

            const price = threshold * (currencyUnitCost ?? NaN);
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            const filteredContains = withoutExcludedItems(new Map(Object.entries(contains)), excludeItemIds);
            if (filteredContains.size === 0) {
                continue;
            }

            const excludingMarket = marketExcludingBonusTier(
                packages,
                exchangeShops,
                items,
                locale,
                shopId,
                thresholdStr,
            );
            const { total, complete, breakdown } = valueOfBundle(
                filteredContains,
                price,
                excludingMarket,
                items,
                locale,
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
 * `options.excludeItemIds`, when given, drops those item ids from every bundle's value/ratio
 * computation (see `withoutExcludedItems`) — e.g. near-universal filler currencies that would
 * otherwise pad every package's value regardless of its actual unique rewards. The market
 * itself is unaffected, so these items are still priced normally wherever something else needs
 * their cost (e.g. as a bundle's own excluded content elsewhere, or a shop's currency).
 */
function buildRanking(data, locale = 'en', options = {}) {
    const { excludeExchangeShops = false, excludeItemIds = null } = options;
    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = excludeExchangeShops ? {} : data.exchange_shops || {};
    const market = createMarket(packages, exchangeShops, items, {}, {}, locale);

    const rankings = [
        ...rankPackages(packages, exchangeShops, items, locale, excludeItemIds),
        ...rankExchangeOffers(exchangeShops, market, items, locale, excludeItemIds),
        ...rankBonusTiers(packages, exchangeShops, market, items, locale, excludeItemIds),
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

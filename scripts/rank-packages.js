const fs = require('fs');
const path = require('path');

const { loadData } = require('./lib/pricing');
const { buildItemValueIndex, OUTPUT_PATH: ITEM_VALUE_INDEX_PATH } = require('./build-item-value-index');

const OUTPUT_PATH = path.join(__dirname, '..', 'output', 'value_ranking.json');

/**
 * Ranks every package AND every exchange shop offer (including bonus tiers) by how much
 * value they provide relative to their price, using the per-item Banknotes costs computed
 * by build-item-value-index.js.
 *
 * "Value" of a purchase option is the sum of (quantity * item.unit_cost) for every item it
 * contains. For "choice" blocks (pick N of several options), the best N choices are assumed,
 * matching the optimistic approach analyze-item-value.js already uses for yield calculations.
 * "value_ratio" (value / price) is the ranking metric: options that return more value per
 * Banknote spent rank higher, i.e. they are the best deals to prioritize buying.
 *
 * The item value index is (re)built automatically if output/item_value_index.json is missing.
 * All generated JSON output is written to the git-ignored output/ folder, not data/.
 *
 * Usage:
 *   node scripts/rank-packages.js
 */

function getUnitCost(itemValueMap, itemId) {
    const entry = itemValueMap[itemId];
    return entry && entry.unit_cost !== null ? entry.unit_cost : 0;
}

function isValueKnown(itemValueMap, itemId) {
    const entry = itemValueMap[itemId];
    return Boolean(entry && entry.unit_cost !== null);
}

/**
 * Value + breakdown of a flat "contains" object: { itemId: quantity, ... }
 */
function valueOfContains(containsObj, itemValueMap, items) {
    let total = 0;
    let complete = true;
    const breakdown = [];

    for (const [itemId, qty] of Object.entries(containsObj || {})) {
        const unitCost = getUnitCost(itemValueMap, itemId);
        const known = isValueKnown(itemValueMap, itemId);
        if (!known) {
            complete = false;
        }
        const value = qty * unitCost;
        total += value;
        breakdown.push({
            item_id: itemId,
            name: items[itemId]?.name?.en || itemId,
            quantity: qty,
            unit_cost: known ? unitCost : null,
            value: known ? Number(value.toFixed(6)) : 0,
        });
    }

    return { total, complete, breakdown };
}

/**
 * Value + breakdown of a "choice" block: { select_count: N, choices: [{itemId: qty}, ...] }
 * Assumes the player always picks the N highest-value choices available.
 */
function valueOfChoice(choiceObj, itemValueMap, items) {
    if (!choiceObj || !Array.isArray(choiceObj.choices) || choiceObj.choices.length === 0) {
        return { total: 0, complete: true, breakdown: [] };
    }

    const selectCount = choiceObj.select_count || 1;
    const evaluatedChoices = choiceObj.choices.map((choiceEntry) => valueOfContains(choiceEntry, itemValueMap, items));

    const bestChoices = [...evaluatedChoices].sort((a, b) => b.total - a.total).slice(0, selectCount);

    let total = 0;
    let complete = true;
    const breakdown = [];
    for (const choice of bestChoices) {
        total += choice.total;
        if (!choice.complete) {
            complete = false;
        }
        breakdown.push(...choice.breakdown);
    }

    return { total, complete, breakdown };
}

function valueOfPackage(pkg, itemValueMap, items) {
    const containsResult = valueOfContains(pkg.contains, itemValueMap, items);
    const choiceResult = valueOfChoice(pkg.choice, itemValueMap, items);

    return {
        total: containsResult.total + choiceResult.total,
        complete: containsResult.complete && choiceResult.complete,
        breakdown: [...containsResult.breakdown, ...choiceResult.breakdown],
    };
}

function rankPackages(packages, itemValueMap, items) {
    const rankings = [];

    for (const [pkgId, pkg] of Object.entries(packages)) {
        const { total, complete, breakdown } = valueOfPackage(pkg, itemValueMap, items);
        const price = pkg.price;
        if (!Number.isFinite(price) || price <= 0) {
            continue;
        }

        rankings.push({
            type: 'package',
            id: pkgId,
            name: pkg.name.en,
            category: pkg.category || '-',
            price,
            price_display: `${price} Banknotes`,
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

function rankExchangeOffers(exchangeShops, itemValueMap, items) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(itemValueMap, shop.currency_item_id);
        const currencyKnown = isValueKnown(itemValueMap, shop.currency_item_id);

        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const offerItemId = offer.item_id || offerKey;
            const unitCost = getUnitCost(itemValueMap, offerItemId);
            const known = isValueKnown(itemValueMap, offerItemId);

            const totalValue = offer.quantity * unitCost;
            const price = offer.currency_cost * currencyUnitCost;
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            rankings.push({
                type: 'exchange_offer',
                id: `${shopId}:${offerKey}`,
                name: `${shop.name.en} - ${items[offerItemId]?.name?.en || offerItemId}`,
                category: shop.category || (shop.event_id ? 'event_exchange' : 'exchange'),
                price: Number(price.toFixed(6)),
                price_display: `${offer.currency_cost} ${items[shop.currency_item_id]?.name?.en || shop.currency_item_id} (~${price.toFixed(2)} Banknotes)`,
                total_value: Number(totalValue.toFixed(2)),
                value_ratio: Number((totalValue / price).toFixed(4)),
                purchase_limit: offer.purchase_limit,
                limit_type: offer.limit_type,
                available_days: null,
                requires: null,
                value_complete: known && currencyKnown,
                contains_breakdown: [
                    {
                        item_id: offerItemId,
                        name: items[offerItemId]?.name?.en || offerItemId,
                        quantity: offer.quantity,
                        unit_cost: known ? unitCost : null,
                        value: known ? Number(totalValue.toFixed(6)) : 0,
                    },
                ],
            });
        }
    }

    return rankings;
}

function rankBonusTiers(exchangeShops, itemValueMap, items) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(itemValueMap, shop.currency_item_id);
        const currencyKnown = isValueKnown(itemValueMap, shop.currency_item_id);

        for (const [thresholdStr, contains] of Object.entries(shop.bonus_tiers || {})) {
            const threshold = Number(thresholdStr);
            if (!Number.isFinite(threshold) || threshold <= 0) {
                continue;
            }

            const { total, complete, breakdown } = valueOfContains(contains, itemValueMap, items);
            const price = threshold * currencyUnitCost;
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            rankings.push({
                type: 'bonus_tier',
                id: `${shopId}:bonus_tier_${thresholdStr}`,
                name: `${shop.name.en} - Bonus Tier (${thresholdStr} ${items[shop.currency_item_id]?.name?.en || shop.currency_item_id})`,
                category: shop.category || (shop.event_id ? 'event_exchange' : 'exchange'),
                price: Number(price.toFixed(6)),
                price_display: `${thresholdStr} ${items[shop.currency_item_id]?.name?.en || shop.currency_item_id} spent (~${price.toFixed(2)} Banknotes)`,
                total_value: Number(total.toFixed(2)),
                value_ratio: Number((total / price).toFixed(4)),
                purchase_limit: 1,
                limit_type: 'cumulative_spend',
                available_days: null,
                requires: null,
                value_complete: complete && currencyKnown,
                contains_breakdown: breakdown,
            });
        }
    }

    return rankings;
}

function buildRanking(data, itemValueIndex) {
    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = data.exchange_shops || {};
    const itemValueMap = itemValueIndex.items || {};

    const rankings = [
        ...rankPackages(packages, itemValueMap, items),
        ...rankExchangeOffers(exchangeShops, itemValueMap, items),
        ...rankBonusTiers(exchangeShops, itemValueMap, items),
    ]
        .filter((entry) => Number.isFinite(entry.value_ratio))
        .sort((a, b) => b.value_ratio - a.value_ratio)
        .map((entry, index) => ({ rank: index + 1, ...entry }));

    return {
        metadata: {
            generated_at: new Date().toISOString(),
            source_last_updated: data.metadata?.last_updated || null,
            currency: data.metadata?.currency || 'Banknotes',
            entry_count: rankings.length,
            note: 'value_ratio = total_value / price. Higher value_ratio means more relative value for the Banknotes spent; entries with value_complete=false contain at least one item with no known purchasable source, so total_value is a lower-bound estimate.',
        },
        rankings,
    };
}

function ensureItemValueIndex(data) {
    if (fs.existsSync(ITEM_VALUE_INDEX_PATH)) {
        return JSON.parse(fs.readFileSync(ITEM_VALUE_INDEX_PATH, 'utf8'));
    }
    console.log('Item value index not found, building it first...');
    const index = buildItemValueIndex(data);
    fs.mkdirSync(path.dirname(ITEM_VALUE_INDEX_PATH), { recursive: true });
    fs.writeFileSync(ITEM_VALUE_INDEX_PATH, `${JSON.stringify(index, null, 4)}\n`, 'utf8');
    return index;
}

function main() {
    const data = loadData();
    const itemValueIndex = ensureItemValueIndex(data);

    const result = buildRanking(data, itemValueIndex);

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(result, null, 4)}\n`, 'utf8');

    console.log(`Ranked ${result.metadata.entry_count} package(s)/exchange offer(s)/bonus tier(s).`);
    console.log('\nTop 15 best value-for-money purchase options:');
    console.table(
        result.rankings.slice(0, 15).map((r) => ({
            Rank: r.rank,
            Name: r.name,
            Type: r.type,
            Price: r.price_display,
            'Value (Banknotes)': r.total_value,
            'Value Ratio': r.value_ratio,
            Complete: r.value_complete,
        })),
    );
    console.log(`\nSaved full ranking to ${OUTPUT_PATH}`);
}

main();

module.exports = { buildRanking, OUTPUT_PATH };

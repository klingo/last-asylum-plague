const fs = require('fs');
const path = require('path');

const { loadData, buildItemCostResolver, collectPackageSources, collectExchangeSources } = require('./lib/pricing');

const OUTPUT_PATH = path.join(__dirname, '..', 'output', 'item_value_index.json');

/**
 * Goes through every single item defined in data/pack_data.json and works out the cheapest
 * way to buy it: the lowest effective Banknotes-per-unit cost, plus the full ranked list of
 * packages/exchange offers that can provide it (mirroring what analyze-item-value.js does
 * for a single item, but for every item at once).
 *
 * Purchase limits are recorded per source but not applied when picking the "unit_cost" itself,
 * since that value represents the theoretical cheapest market price of the item; it is used as
 * the building block for rank-packages.js, which ranks packages/exchange offers by the total
 * value of everything they contain.
 *
 * The resulting index is written to output/item_value_index.json (a generated, git-ignored
 * output folder, not data/) so it can be re-read by rank-packages.js (or any other script/UI)
 * without recomputing everything from scratch.
 *
 * Usage:
 *   node scripts/build-item-value-index.js
 */

function simplifySource(source) {
    return {
        type: source.type,
        id: source.id,
        name: source.name,
        category: source.category || '-',
        price: source.price,
        price_display: source.priceDisplay || null,
        yield_per_purchase: Number(source.yieldPerPurchase.toFixed(6)),
        price_per_unit: Number.isFinite(source.pricePerUnit) ? Number(source.pricePerUnit.toFixed(6)) : null,
        purchase_limit: source.purchaseLimit,
        limit_type: source.limitType,
        available_days: source.availableDays,
        requires: source.requires,
    };
}

function buildItemValueIndex(data) {
    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = data.exchange_shops || {};

    const getItemCost = buildItemCostResolver(packages, exchangeShops, items);

    const itemEntries = {};
    for (const [itemId, item] of Object.entries(items)) {
        const packageSources = collectPackageSources(itemId, packages, items, {}, null, false, true);
        const exchangeSources = collectExchangeSources(itemId, exchangeShops, items, getItemCost);

        const sources = [...packageSources, ...exchangeSources]
            .filter((s) => Number.isFinite(s.pricePerUnit))
            .sort((a, b) => a.pricePerUnit - b.pricePerUnit)
            .map(simplifySource);

        const unitCost = getItemCost(itemId);

        itemEntries[itemId] = {
            name: item.name.en,
            category: item.category || '-',
            unit_cost: Number.isFinite(unitCost) ? Number(unitCost.toFixed(6)) : null,
            source_count: sources.length,
            sources,
        };
    }

    return {
        metadata: {
            generated_at: new Date().toISOString(),
            source_last_updated: data.metadata?.last_updated || null,
            currency: data.metadata?.currency || 'Banknotes',
            item_count: Object.keys(itemEntries).length,
        },
        items: itemEntries,
    };
}

function main() {
    const data = loadData();
    const index = buildItemValueIndex(data);

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(index, null, 4)}\n`, 'utf8');

    const withCost = Object.values(index.items).filter((entry) => entry.unit_cost !== null).length;
    const withoutCost = index.metadata.item_count - withCost;

    console.log(`Built item value index for ${index.metadata.item_count} item(s).`);
    console.log(`  ${withCost} item(s) have a resolvable Banknotes cost.`);
    if (withoutCost > 0) {
        console.log(`  ${withoutCost} item(s) have no known purchasable source and were left without a unit_cost.`);
    }
    console.log(`Saved to ${OUTPUT_PATH}`);
}

if (require.main === module) {
    main();
}

module.exports = { buildItemValueIndex, OUTPUT_PATH };

import { test } from 'node:test';
import { createUnitCounter, isContainerItem, isValueLevel, itemChainTops } from '../webapp/src/core/item-sources.js';
import { loadFixture, expectGolden } from './helpers.js';

const data = loadFixture();

test('units of an item per purchase (Item Sources, "Only here")', () => {
    const targets = ['speedup', 'cloth', 'herbs', 'raven_essence', 'ur_hero_omni_shard', 'lv1_sharp_beak', 'diamonds'];
    const result = {};
    for (const targetId of targets) {
        const counter = createUnitCounter(data.items, targetId);
        const sources = new Map();
        for (const [id, pkg] of Object.entries(data.packages)) {
            const r = counter.ofBundle(pkg);
            if (r.units > 0) {
                sources.set(`package:${id}`, r);
            }
        }
        for (const [shopId, shop] of Object.entries(data.exchange_shops)) {
            for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
                const r = counter.ofItem(offer.item_id);
                if (r.units > 0) {
                    sources.set(`offer:${shopId}:${offerKey}`, { units: r.units * offer.quantity, random: r.random });
                }
            }
        }
        result[targetId] = sources;
    }
    expectGolden('item-sources', {
        units: result,
        containers: Object.keys(data.items).filter((id) => isContainerItem(data.items[id])),
        valueLevels: Object.keys(data.items).filter((id) => isValueLevel(data.items[id])),
        chainTops: itemChainTops(data.items),
        convertibleChainTops: itemChainTops(data.items, { convertibleOnly: true }),
    });
});

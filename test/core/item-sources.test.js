import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createUnitCounter,
    hasOtherSource,
    isContainerItem,
    isValueLevel,
    itemChainTops,
    sourcesListing,
} from '../../webapp/src/core/item-sources.js';
import { loadFixture, expectGolden } from '../helpers.js';

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

test('an item with another source than one shop ("Only here" otherwise)', () => {
    const shop = (itemId) => ({ offers: { o: { item_id: itemId } } });
    const base = {
        items: { gem: {}, ore: {}, chest: { type: 'random', drop_table: [{ probability: 1, contains: { ore: 1 } }] } },
        packages: { pack: { contains: { chest: 1 } } },
        exchange_shops: { a: shop('gem'), b: shop('gem'), c: shop('ore') },
    };
    // Gems only come from the shops: another shop (b) is another source for a, but not for itself alone.
    assert.equal(hasOtherSource(base, 'a', 'gem'), true);
    assert.equal(hasOtherSource({ ...base, exchange_shops: { a: shop('gem') } }, 'a', 'gem'), false);
    // Ore comes from a pack (inside a random chest) too.
    assert.equal(hasOtherSource({ ...base, exchange_shops: { c: shop('ore') } }, 'c', 'ore'), true);
});

test('Item Sources lists base items; a container stands for its contents, a chain for its top', () => {
    const items = {
        ore: {},
        chest: { type: 'chest', contains: { ore: 5 } },
        cloth: {},
        steel: { crafted_from: { cloth: 3 }, reversible: true },
        beak_lv1: { value_equivalent: { beak_lv3: 9 } },
        beak_lv3: {},
    };
    const listing = sourcesListing(items);
    assert.equal(listing.listed.has('ore'), true);
    assert.equal(listing.listed.has('chest'), false, 'a container');
    assert.equal(listing.sourcesItemFor('chest'), null, 'and has no listing of its own');
    assert.equal(listing.listed.has('beak_lv1'), true, 'value levels are listed each');
    assert.equal(listing.sourcesItemFor('ore'), 'ore');
    assert.equal(listing.sourcesItemFor('unknown'), null);
});

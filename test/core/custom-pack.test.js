import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_ITEMS,
    MAX_SLOTS,
    MAX_OPTIONS,
    parseCustomPack,
    customPackParams,
    valueCustomPack,
    dealRank,
    dealValues,
    dealCheck,
} from '../../webapp/src/core/custom-pack.js';
import { currencyItemIds } from '../../webapp/src/core/catalog.js';
import { loadSetup, near } from '../helpers.js';

const ITEMS = { gem: {}, wood: {}, steel: {}, mystery: {}, diamonds: {} };
const readFrom = (query) => {
    const params = new URLSearchParams(query);
    return (name) => params.get(name);
};

test('custom pack: the URL round trip keeps items, slots, price and deal %', () => {
    const pack = parseCustomPack(readFrom('items=gem:3,wood:10&c1=steel:2,gem:5&c2=wood:1&price=999&deal=1200'), ITEMS);
    assert.deepEqual(pack, {
        items: [
            { id: 'gem', qty: 3 },
            { id: 'wood', qty: 10 },
        ],
        slots: [
            [
                { id: 'steel', qty: 2 },
                { id: 'gem', qty: 5 },
            ],
            [{ id: 'wood', qty: 1 }],
        ],
        price: 999,
        deal: 1200,
    });
    assert.deepEqual(customPackParams(pack), {
        items: 'gem:3,wood:10',
        price: 999,
        c1: 'steel:2,gem:5',
        c2: 'wood:1',
        deal: 1200,
    });
});

test('custom pack: unknown items, bad amounts and anything beyond the limits are dropped', () => {
    const many = Array.from({ length: MAX_ITEMS + 3 }, () => 'gem:1').join(',');
    const options = Array.from({ length: MAX_OPTIONS + 2 }, () => 'wood:2').join(',');
    const pack = parseCustomPack(
        readFrom(`items=nope:1,gem:0,wood:-2,steel:x,steel:2.9,${many}&c1=${options}&c2=nope:1&c3=gem:1&price=-5`),
        ITEMS,
    );
    assert.deepEqual(pack.items[0], { id: 'steel', qty: 2 });
    assert.equal(pack.items.length, MAX_ITEMS);
    assert.equal(pack.slots.length, 2, 'a slot without a known option is no slot');
    assert.equal(pack.slots[0].length, MAX_OPTIONS);
    assert.equal(pack.price, 0);
    assert.equal(pack.deal, 0);
    assert.equal(MAX_SLOTS, 3);
});

test('custom pack: rows still being typed (no item or amount) stay out of the URL', () => {
    const pack = {
        items: [
            { id: 'gem', qty: 2 },
            { id: '', qty: 1 },
            { id: 'wood', qty: 0 },
        ],
        slots: [[{ id: '', qty: 1 }], [{ id: 'steel', qty: 1 }]],
        price: 0,
        deal: 0,
    };
    assert.deepEqual(customPackParams(pack), { items: 'gem:2', price: null, c1: 'steel:1', deal: null });
});

// A stand-in for valuation.bundle: worth by item, `mystery` has none.
const WORTH = { gem: 10, wood: 1, steel: 4, diamonds: 0.5 };
function bundleOf(contents, price) {
    let worth = 0;
    let incomplete = false;
    for (const [id, qty] of Object.entries(contents)) {
        if (id in WORTH) {
            worth += WORTH[id] * qty;
        } else {
            incomplete = true;
        }
    }
    return { worth, points: worth * 2, ratio: price > 0 ? worth / price : null, incomplete, parts: [contents] };
}

test('custom pack: a slot counts at its best option, the items and the pick add up', () => {
    const pack = {
        items: [
            { id: 'wood', qty: 10 },
            { id: 'wood', qty: 5 },
            { id: '', qty: 1 },
        ],
        slots: [
            [
                { id: 'steel', qty: 2 },
                { id: 'gem', qty: 1 },
                { id: 'wood', qty: 7 },
            ],
            [],
        ],
        price: 50,
        deal: 0,
    };
    const value = valueCustomPack(pack, bundleOf);
    // gem (10) beats steel (8) and wood (7); the same item twice is one entry of the bundle.
    assert.deepEqual(value.contents, { wood: 15, gem: 1 });
    assert.equal(value.slots[0].picked, 1);
    assert.deepEqual(
        value.slots[0].options.map((option) => option.worth),
        [8, 10, 7],
    );
    assert.equal(value.slots[1].picked, -1);
    near(value.worth, 25);
    near(value.ratio, 0.5);
    assert.equal(value.incomplete, false);
});

test('custom pack: an item without worth makes the pack incomplete, no price gives no ratio', () => {
    const value = valueCustomPack({ items: [{ id: 'mystery', qty: 1 }], slots: [], price: 0, deal: 0 }, bundleOf);
    assert.equal(value.incomplete, true);
    assert.equal(value.ratio, null);
    assert.equal(value.worth, 0);
});

test('custom pack: the place among the packs on sale', () => {
    assert.deepEqual(dealRank(1.2, [2, 1.5, 1, 0.5]), { rank: 3, total: 5 });
    assert.deepEqual(dealRank(3, [2, 1.5]), { rank: 1, total: 3 });
    assert.deepEqual(dealRank(0.1, [2, 1.5]), { rank: 3, total: 3 });
    assert.deepEqual(dealRank(1, []), { rank: 1, total: 1 });
});

test('custom pack: the deal % check needs a price and a deal %', async () => {
    const { data, fit } = await loadSetup();
    const values = dealValues(data, fit);
    assert.equal(dealCheck({ items: [{ id: 'diamonds', qty: 100 }], slots: [], price: 0, deal: 500 }, values), null);
    assert.equal(dealCheck({ items: [{ id: 'diamonds', qty: 100 }], slots: [], price: 99, deal: 0 }, values), null);
});

test('custom pack: diamonds are the claim itself, flagged when the deal % is far from them', async () => {
    const { data, fit } = await loadSetup();
    const values = dealValues(data, fit);
    // 1 point per diamond: a deal % of 100 claims what the price is, 1000 diamonds for 1000 Banknotes.
    const pack = { items: [{ id: 'diamonds', qty: 1000 }], slots: [], price: 1000, deal: 100 };
    const exact = dealCheck(pack, values);
    near(exact.claim, 1000);
    near(exact.points, 1000);
    near(exact.factor, 1);
    assert.equal(exact.flagged, false);
    assert.equal(dealCheck({ ...pack, deal: 300 }, values).flagged, true, 'the game claims 3× what is there');
    assert.equal(dealCheck({ ...pack, deal: 50 }, values).flagged, true, 'the model counts 2× what the game claims');
    assert.equal(dealCheck({ ...pack, deal: 120 }, values).flagged, false, 'within the factor');
});

test('custom pack: a data pack with its own deal % passes, the same with a mistyped amount is flagged', async () => {
    const { data, fit } = await loadSetup();
    const values = dealValues(data, fit);
    const entry = Object.values(data.packages).find((pkg) => {
        const ids = Object.keys(pkg.contains || {});
        if (!(pkg.deal_percentage > 0) || pkg.choice || ids.length < 3) {
            return false;
        }
        const pack = { items: ids.map((id) => ({ id, qty: pkg.contains[id] })), slots: [], price: pkg.price, deal: 1 };
        return dealCheck(pack, values)?.incomplete === false;
    });
    assert.ok(entry, 'the fixture has a pack the check can value');
    const items = Object.entries(entry.contains).map(([id, qty]) => ({ id, qty }));
    const real = dealCheck({ items, slots: [], price: entry.price, deal: entry.deal_percentage }, values);
    assert.equal(real.flagged, false, `the fit reproduces its own pack (factor ${real.factor})`);
    const typo = items.map((item, index) => (index === 0 ? { ...item, qty: item.qty * 100 } : item));
    assert.equal(
        dealCheck({ items: typo, slots: [], price: entry.price, deal: entry.deal_percentage }, values).flagged,
        true,
    );
});

test('custom pack: a slot in the deal % check counts at its best option; a coin has the fitted value, an unmodelled item none', async () => {
    const { data, fit } = await loadSetup();
    const values = dealValues(data, fit);
    const slot = [
        { id: 'diamonds', qty: 10 },
        { id: 'diamonds', qty: 300 },
        { id: 'diamonds', qty: 50 },
    ];
    const check = dealCheck({ items: [], slots: [slot], price: 300, deal: 100 }, values);
    near(check.points, 300);
    // An event coin has the value the fit gave it; the Star Moon Sigil is unmodelled, so it has none.
    const coinId = [...currencyItemIds(data)].find((id) => id !== 'diamonds' && fit.paramValues.has(id));
    const coin = dealCheck({ items: [{ id: coinId, qty: 1000 }], slots: [], price: 300, deal: 100 }, values);
    assert.equal(coin.incomplete, false);
    assert.ok(coin.points > 0);
    const sigil = dealCheck({ items: [{ id: 'star_moon_sigil', qty: 5 }], slots: [], price: 300, deal: 100 }, values);
    assert.equal(sigil.incomplete, true);
});

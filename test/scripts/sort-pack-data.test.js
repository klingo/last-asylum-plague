import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortPackData } from '../../scripts/sort-pack-data.js';
import { PACK_DATA_PATH, readJson } from '../../scripts/lib/data-files.js';

test('sections and their entries are sorted by id, numeric keys by number', () => {
    const data = sortPackData({
        items: { b: {}, a: {} },
        packages: { z: { tiers: { 10: {}, 2: {} } }, y: {} },
        exchange_shops: {
            shop: { offers: { two: {}, one: {} }, bonus_tiers: { 100: 'c', 20: 'b', 3: 'a' } },
        },
        mines: { m: { progress_rewards: { 10: {}, 5: {} } } },
    });
    assert.deepEqual(Object.keys(data.items), ['a', 'b']);
    assert.deepEqual(Object.keys(data.packages), ['y', 'z']);
    assert.deepEqual(Object.keys(data.packages.z.tiers), ['2', '10']);
    assert.deepEqual(Object.keys(data.exchange_shops.shop.offers), ['one', 'two']);
    assert.deepEqual(Object.keys(data.exchange_shops.shop.bonus_tiers), ['3', '20', '100']);
    assert.deepEqual(Object.keys(data.mines.m.progress_rewards), ['5', '10']);
});

test('conversions and tiers of spend reward tracks are sorted by price and threshold', () => {
    const data = sortPackData({
        spend_reward_conversions: [{ price: 499 }, { price: 99 }],
        spend_reward_tracks: { t: { tiers: { 300: {}, 50: {} }, conversions: [{ price: 5 }, { price: 1 }] } },
    });
    assert.deepEqual(
        data.spend_reward_conversions.map((c) => c.price),
        [99, 499],
    );
    assert.deepEqual(Object.keys(data.spend_reward_tracks.t.tiers), ['50', '300']);
    assert.deepEqual(
        data.spend_reward_tracks.t.conversions.map((c) => c.price),
        [1, 5],
    );
});

test('the schedule has its ids alphabetical and each id with its runs oldest first', () => {
    const data = sortPackData({
        schedule: {
            b: [{ start: '2026-02-01' }, { start: '2026-01-01' }],
            a: [],
        },
    });
    assert.deepEqual(Object.keys(data.schedule), ['a', 'b']);
    assert.deepEqual(
        data.schedule.b.map((run) => run.start),
        ['2026-01-01', '2026-02-01'],
    );
});

test('orders that carry meaning stay: rotation phases and guide paths', () => {
    const data = sortPackData({
        event_rotations: { r: { phases: [{ id: 'z' }, { id: 'a' }], week: ['z', 'a'] } },
        squad_guides: { g: { craft_path: [{ item: 'z' }, { item: 'a' }] } },
    });
    assert.deepEqual(
        data.event_rotations.r.phases.map((phase) => phase.id),
        ['z', 'a'],
    );
    assert.deepEqual(
        data.squad_guides.g.craft_path.map((step) => step.item),
        ['z', 'a'],
    );
});

test('data without these sections is fine, and the real data is already sorted', () => {
    assert.deepEqual(sortPackData({}), {});
    const data = readJson(PACK_DATA_PATH);
    assert.equal(JSON.stringify(sortPackData(structuredClone(data))), JSON.stringify(data));
});

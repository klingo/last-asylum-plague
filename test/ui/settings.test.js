import { storage } from './env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameDay } from '../../webapp/src/core/schedule.js';
import { DEFAULT_SETTINGS } from '../../webapp/src/core/settings-model.js';
import {
    SETTINGS_KEY,
    getSettings,
    loadSettings,
    onSettingsChange,
    updateSettings,
} from '../../webapp/src/ui/settings.js';

const save = (stored) => storage.set(SETTINGS_KEY, JSON.stringify(stored));

beforeEach(() => storage.clear());

test('nothing saved: the defaults', () => {
    assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS, version: 3 });
});

test('broken saved text: the defaults', () => {
    storage.set(SETTINGS_KEY, '{oops');
    assert.equal(loadSettings().budget, DEFAULT_SETTINGS.budget);
});

test('saved values are taken, bad ones are dropped', () => {
    save({
        version: 3,
        budget: 5000,
        followsCalendar: false,
        activeEvents: ['mine', 7],
        seasonalPasses: ['gear_pass'],
        extraCurrency: { diamonds: 3000, gem: -1, coin: 0 },
        extraEventBanknotes: { mine: 500, other: 0 },
        lockedOffers: { 'shop:a': 2, 'shop:b': -1 },
        minePlanSafety: 0.9,
        mineProgress: { mine: { pickaxes: 12, floor: 4, run: 100 }, junk: 5 },
        priorities: { gem: 'high', ore: 'normal', pick: 'bogus' },
    });
    const settings = loadSettings();
    assert.equal(settings.budget, 5000);
    assert.equal(settings.followsCalendar, false);
    assert.deepEqual(settings.activeEvents, ['mine']);
    assert.deepEqual(settings.seasonalPasses, ['gear_pass']);
    assert.deepEqual(settings.extraCurrency, { diamonds: 3000 });
    assert.deepEqual(settings.extraEventBanknotes, { mine: 500 });
    assert.deepEqual(settings.lockedOffers, { 'shop:a': 2 });
    assert.equal(settings.minePlanSafety, 0.9);
    assert.deepEqual(settings.mineProgress, { mine: { pickaxes: 12, floor: 4, run: 100 } });
    assert.deepEqual(settings.priorities, { gem: 'high' }, 'normal is the default, unknown levels are dropped');
});

test('a safety level that is not offered falls back to the default', () => {
    save({ version: 3, minePlanSafety: 0.77, budget: -5 });
    const settings = loadSettings();
    assert.equal(settings.minePlanSafety, DEFAULT_SETTINGS.minePlanSafety);
    assert.equal(settings.budget, DEFAULT_SETTINGS.budget, 'a negative budget is no budget');
});

test('skips that are over are dropped', () => {
    const today = gameDay(new Date()).day;
    save({ version: 3, skippedPackages: { over: today - 1, running: today + 3 } });
    assert.deepEqual(loadSettings().skippedPackages, { running: today + 3 });
});

test('older settings: a single pass, extra diamonds, ignored items and personal weights migrate', () => {
    save({
        seasonalPass: 'gear_pass',
        extraDiamonds: 4000,
        ignoredItems: ['stamina_extra'],
        itemWeights: { gem: 2, ore: 0.5, shard: 1, junk: 0 },
    });
    const settings = loadSettings();
    assert.deepEqual(settings.seasonalPasses, ['gear_pass']);
    assert.deepEqual(settings.extraCurrency, { diamonds: 4000 });
    assert.equal(settings.priorities.stamina_extra, 'none');
    assert.equal(settings.priorities.gem, 'high');
    assert.equal(settings.priorities.ore, 'low');
    assert.equal(settings.priorities.shard, undefined, 'normal is the default');
    assert.equal(settings.priorities.junk, 'none');
    assert.equal(settings.priorities.vip_points, 'none', 'the defaults stay');
    assert.equal(settings.version, 3);
});

test('a change is saved and told to the listeners', () => {
    const told = [];
    onSettingsChange((settings) => told.push(settings.budget));
    updateSettings({ budget: 1234 });
    assert.deepEqual(told, [1234]);
    assert.equal(getSettings().budget, 1234);
    assert.equal(JSON.parse(storage.get(SETTINGS_KEY)).budget, 1234);
});

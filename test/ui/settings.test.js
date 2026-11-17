import { storage } from './env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gameDay } from '../../webapp/src/core/schedule.js';
import { DEFAULT_SETTINGS } from '../../webapp/src/core/settings-model.js';
import {
    getSettings,
    loadSettings,
    onSettingsChange,
    setTodayLevel,
    updateSettings,
} from '../../webapp/src/ui/settings.js';
import { STORAGE_KEYS } from '../../webapp/src/ui/storage.js';

const save = (stored) => storage.set(STORAGE_KEYS.settings, JSON.stringify(stored));

beforeEach(() => storage.clear());

test('nothing saved: the defaults', () => {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('broken saved text: the defaults', () => {
    storage.set(STORAGE_KEYS.settings, '{oops');
    assert.equal(loadSettings().budget, DEFAULT_SETTINGS.budget);
});

test('saved values are taken, bad ones are dropped', () => {
    save({
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
    save({ minePlanSafety: 0.77, budget: -5 });
    const settings = loadSettings();
    assert.equal(settings.minePlanSafety, DEFAULT_SETTINGS.minePlanSafety);
    assert.equal(settings.budget, DEFAULT_SETTINGS.budget, 'a negative budget is no budget');
});

test('skips that are over are dropped', () => {
    const today = gameDay(new Date()).day;
    save({ skippedPackages: { over: today - 1, running: today + 3 } });
    assert.deepEqual(loadSettings().skippedPackages, { running: today + 3 });
});

test('a change is saved and told to the listeners', () => {
    const told = [];
    onSettingsChange((settings, patch) => told.push([settings.budget, patch]));
    updateSettings({ budget: 1234 });
    assert.deepEqual(told, [[1234, { budget: 1234 }]], 'the listener gets the settings and what changed');
    assert.equal(getSettings().budget, 1234);
    assert.equal(JSON.parse(storage.get(STORAGE_KEYS.settings)).budget, 1234);
});

test('Today level: a new visitor starts at standard, earlier settings keep everything', () => {
    assert.equal(DEFAULT_SETTINGS.todayLevel, 'standard');
    assert.equal(DEFAULT_SETTINGS.todayLevelHintClosed, false);
    save({ budget: 5000 });
    assert.equal(loadSettings().todayLevel, 'all', 'saved before there was a choice');
    assert.equal(loadSettings().todayLevelHintClosed, true, 'and no hint for them');
    save({ todayLevel: 'standard' });
    assert.equal(loadSettings().todayLevel, 'standard');
    assert.equal(loadSettings().todayLevelHintClosed, false, 'chosen but the hint not closed: still shown');
    save({ todayLevel: 'essentials', todayLevelHintClosed: true });
    assert.deepEqual(
        [loadSettings().todayLevel, loadSettings().todayLevelHintClosed],
        ['essentials', true],
        'a saved level and a closed hint are kept',
    );
    save({ todayLevel: 'bogus', todayLevelHintClosed: 'yes' });
    assert.equal(loadSettings().todayLevel, 'all', 'a level that does not exist counts as none chosen');
    assert.equal(loadSettings().todayLevelHintClosed, true, 'only a boolean counts');
});

test('choosing a Today level saves it and closes the hint', () => {
    setTodayLevel('standard');
    assert.equal(getSettings().todayLevel, 'standard');
    assert.equal(getSettings().todayLevelHintClosed, true);
    const saved = JSON.parse(storage.get(STORAGE_KEYS.settings));
    assert.deepEqual([saved.todayLevel, saved.todayLevelHintClosed], ['standard', true]);
});

test('the hidden Today entries of earlier versions are no longer read', () => {
    save({ hiddenTodayEntries: ['quiz_of_wisdom'], budget: 5000 });
    assert.equal('hiddenTodayEntries' in loadSettings(), false);
    assert.equal(loadSettings().budget, 5000);
});

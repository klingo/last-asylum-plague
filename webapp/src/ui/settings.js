/**
 * Settings shared by every page (persisted in localStorage): weekly Banknote spend, events running
 * this week, seasonal passes on sale, and the user's item priorities.
 *
 * The page's one copy: `getSettings()` reads it, `updateSettings(patch)` changes and saves it and tells
 * every `onSettingsChange` listener (the setup panel, the page's recalculation). Their defaults and what the model
 * reads from them are in core/settings-model.js.
 */
import { gameDay } from '../core/schedule.js';
import { readJson, writeJson } from './storage.js';
import { DEFAULT_SETTINGS, MINE_SAFETY_LEVELS, PRIORITY_LEVELS } from '../core/settings-model.js';

const STORAGE_KEY = 'lasps_valuation';
// Bumped when the stored shape changes (see loadSettings for the migrations).
const SETTINGS_VERSION = 3;

/** Nearest priority level for an old weight factor. */
function levelForWeight(weight) {
    if (weight <= 0.25) {
        return 'none';
    }
    if (weight < 0.75) {
        return 'low';
    }
    return weight >= 1.5 ? 'high' : 'normal';
}

function loadSettings() {
    const stored = readJson(STORAGE_KEY);
    const settings = { ...DEFAULT_SETTINGS, priorities: { ...DEFAULT_SETTINGS.priorities } };
    if (Number.isFinite(stored.budget) && stored.budget >= 0) {
        settings.budget = stored.budget;
    }
    if (typeof stored.seasonalPass === 'string') {
        // Older settings: a single seasonal pass on sale.
        settings.seasonalPasses = [stored.seasonalPass];
    }
    if (typeof stored.vipPointsInWorth === 'boolean') {
        settings.vipPointsInWorth = stored.vipPointsInWorth;
    }
    if (typeof stored.followsCalendar === 'boolean') {
        settings.followsCalendar = stored.followsCalendar;
    }
    if (stored.extraCurrency && typeof stored.extraCurrency === 'object') {
        settings.extraCurrency = Object.fromEntries(
            Object.entries(stored.extraCurrency).filter(([, amount]) => Number.isFinite(amount) && amount > 0),
        );
    } else if (Number.isFinite(stored.extraDiamonds) && stored.extraDiamonds > 0) {
        // Older settings: the extra diamonds of the VIP Shop.
        settings.extraCurrency = { diamonds: stored.extraDiamonds };
    }
    if (stored.skippedPackages && typeof stored.skippedPackages === 'object') {
        const today = gameDay(new Date()).day;
        settings.skippedPackages = Object.fromEntries(
            Object.entries(stored.skippedPackages).filter(([, until]) => Number.isFinite(until) && until > today),
        );
    }
    if (stored.lockedOffers && typeof stored.lockedOffers === 'object') {
        settings.lockedOffers = Object.fromEntries(
            Object.entries(stored.lockedOffers).filter(([, count]) => Number.isFinite(count) && count >= 0),
        );
    }
    if (stored.extraEventBanknotes && typeof stored.extraEventBanknotes === 'object') {
        settings.extraEventBanknotes = Object.fromEntries(
            Object.entries(stored.extraEventBanknotes).filter(([, amount]) => Number.isFinite(amount) && amount > 0),
        );
    }
    if (MINE_SAFETY_LEVELS.includes(stored.minePlanSafety)) {
        settings.minePlanSafety = stored.minePlanSafety;
    }
    if (stored.mineProgress && typeof stored.mineProgress === 'object') {
        settings.mineProgress = Object.fromEntries(
            Object.entries(stored.mineProgress)
                .filter(([, progress]) => progress && typeof progress === 'object')
                .map(([mineId, { pickaxes, floor, run }]) => [
                    mineId,
                    {
                        pickaxes: Number.isFinite(pickaxes) && pickaxes > 0 ? pickaxes : 0,
                        floor: Number.isFinite(floor) && floor > 0 ? floor : 0,
                        run: Number.isFinite(run) ? run : null,
                    },
                ]),
        );
    }
    for (const key of ['activeEvents', 'seasonalPasses']) {
        if (Array.isArray(stored[key])) {
            settings[key] = stored[key].filter((id) => typeof id === 'string');
        }
    }
    if (stored.version === SETTINGS_VERSION && stored.priorities && typeof stored.priorities === 'object') {
        settings.priorities = Object.fromEntries(
            Object.entries(stored.priorities).filter(
                ([, level]) => PRIORITY_LEVELS.includes(level) && level !== 'normal',
            ),
        );
    } else {
        // Older settings: ignored items and personal weights become priorities (defaults kept).
        for (const id of Array.isArray(stored.ignoredItems) ? stored.ignoredItems : []) {
            settings.priorities[id] = 'none';
        }
        for (const [id, weight] of Object.entries(stored.itemWeights || {})) {
            if (Number.isFinite(weight) && weight >= 0) {
                const level = levelForWeight(weight);
                if (level === 'normal') {
                    delete settings.priorities[id];
                } else {
                    settings.priorities[id] = level;
                }
            }
        }
    }
    settings.version = SETTINGS_VERSION;
    return settings;
}

function saveSettings(settings) {
    writeJson(STORAGE_KEY, settings);
}

let current = null;
const listeners = new Set();

/** The current settings (loaded once per page). */
function getSettings() {
    current ??= loadSettings();
    return current;
}

/** Changes the settings by `patch`, saves them and notifies the listeners. */
function updateSettings(patch) {
    current = { ...getSettings(), ...patch };
    saveSettings(current);
    for (const listener of listeners) {
        listener(current);
    }
}

/** Calls `listener(settings)` after every change. */
function onSettingsChange(listener) {
    listeners.add(listener);
}

export { STORAGE_KEY as SETTINGS_KEY, getSettings, updateSettings, onSettingsChange };

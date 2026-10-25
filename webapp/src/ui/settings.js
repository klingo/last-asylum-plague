/**
 * Settings shared by every page (persisted in localStorage): weekly Banknote spend, events running
 * this week, seasonal passes on sale, and the user's item priorities.
 *
 * The page's one copy: `getSettings()` reads it, `updateSettings(patch)` changes and saves it and tells
 * every `onSettingsChange` listener (the setup panel, the page's recalculation).
 */
const STORAGE_KEY = 'lasps_valuation';
// Bumped when the stored shape changes (see loadSettings for the migrations).
const SETTINGS_VERSION = 3;

// How much an item matters to the user, as a factor on its worth (after the deal % fit).
const PRIORITY_WEIGHTS = { none: 0, low: 0.5, normal: 1, high: 1.5 };
const PRIORITY_LEVELS = ['none', 'low', 'normal', 'high'];
// How sure the pickaxes planned for a mine's target floor are: the share of runs they suffice in.
const MINE_SAFETY_LEVELS = [0.5, 0.9, 0.99, 1];

// Worth nothing to a typical player, so "Don't care" unless changed. They still count in the
// deal % fit (the game counts them), see point-fit.js.
const DEFAULT_NONE_ITEMS = [
    'vip_points',
    'lv1_alliance_chest',
    'lv2_alliance_chest',
    'lv3_alliance_chest',
    'lv4_alliance_chest',
    'lv5_alliance_chest',
    'lv6_alliance_chest',
    'top_up_exp',
    'stamina',
    'direct_relocate',
];

const DEFAULT_SETTINGS = {
    budget: 20000, // Banknotes per week
    // VIP points count in the deal % fit (false: worth 0, the rest of a pack carries its price) (Home). Stored
    // under this name since the default became false, so a `countVipPoints: true` saved before doesn't stick.
    vipPointsInWorth: false,
    extraDiamonds: 0, // diamonds per week from outside the packs, for the VIP Shop (Events page)
    extraEventBanknotes: {}, // eventId -> extra Banknotes per week only for that event's packs (Events page)
    exceedEventLimits: [], // event ids whose pack limits the Events page lifts ("Exceed event pack limits")
    lockedOffers: {}, // "<shopId>:<offerKey>" -> exact count the plan buys per week, 0 = never (Events page)
    mineProgress: {}, // mineId -> { pickaxes owned, floor reached, run: start day of the run the floor is from } (Events page)
    minePlanSafety: 1, // share of runs the planned pickaxes suffice in: 0.5 (average), 0.9, 0.99, 1 (worst case) (Events page)
    activeEvents: [], // event ids running this week
    seasonalPasses: [], // family ids of the seasonal passes on sale right now; other passes are always on sale
    priorities: Object.fromEntries(DEFAULT_NONE_ITEMS.map((id) => [id, 'none'])), // itemId -> level ('normal' omitted)
};

/** Items worth 0 points in the deal % fit by the settings (point-fit.js `zeroItems`): VIP points, if not counted. */
function zeroFitItems(settings) {
    return settings.vipPointsInWorth ? [] : ['vip_points'];
}

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
    let stored;
    try {
        stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch {
        stored = {};
    }
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
    if (Number.isFinite(stored.extraDiamonds) && stored.extraDiamonds >= 0) {
        settings.extraDiamonds = stored.extraDiamonds;
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
    for (const key of ['activeEvents', 'seasonalPasses', 'exceedEventLimits']) {
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
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // localStorage may be unavailable (private browsing, etc.)
    }
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

/** `{ itemId: factor }` for the valuation (items at "normal" are left out). */
function priorityWeights(settings) {
    return Object.fromEntries(
        Object.entries(settings.priorities || {}).map(([id, level]) => [id, PRIORITY_WEIGHTS[level] ?? 1]),
    );
}

export {
    STORAGE_KEY as SETTINGS_KEY,
    getSettings,
    updateSettings,
    onSettingsChange,
    priorityWeights,
    DEFAULT_SETTINGS,
    DEFAULT_NONE_ITEMS,
    PRIORITY_LEVELS,
    PRIORITY_WEIGHTS,
    MINE_SAFETY_LEVELS,
    zeroFitItems,
};

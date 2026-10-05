/**
 * Settings shared by every page (persisted in localStorage): weekly Banknote spend, events running
 * this week, seasonal passes on sale, and the user's item priorities.
 */
const STORAGE_KEY = 'lasps_valuation';
// Bumped when the stored shape changes (see loadSettings for the migrations).
const SETTINGS_VERSION = 3;

// How much an item matters to the user, as a factor on its worth (after the deal % fit).
const PRIORITY_WEIGHTS = { none: 0, low: 0.5, normal: 1, high: 2 };
const PRIORITY_LEVELS = ['none', 'low', 'normal', 'high'];

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
    activeEvents: [], // event ids running this week
    seasonalPass: null, // family id of the one seasonal pass on sale right now (null = none); other passes are always on sale
    priorities: Object.fromEntries(DEFAULT_NONE_ITEMS.map((id) => [id, 'none'])), // itemId -> level ('normal' omitted)
};

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
        settings.seasonalPass = stored.seasonalPass;
    }
    for (const key of ['activeEvents']) {
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

/** `{ itemId: factor }` for the valuation (items at "normal" are left out). */
function priorityWeights(settings) {
    return Object.fromEntries(
        Object.entries(settings.priorities || {}).map(([id, level]) => [id, PRIORITY_WEIGHTS[level] ?? 1]),
    );
}

export { loadSettings, saveSettings, priorityWeights, DEFAULT_SETTINGS, PRIORITY_LEVELS, PRIORITY_WEIGHTS };

/**
 * The user's settings as the model reads them (the browser stores them: ui/settings.js): their defaults, the item
 * priorities as weights, the items the fit leaves out, and the options of the weekly plan (planner.js) they make.
 *
 * Pure module (no DOM, no clock: the caller passes the game day), shared with the tests.
 */
import { activeSkips } from './skips.js';

// How much an item matters to the user, as a factor on its worth (after the deal % fit).
const PRIORITY_WEIGHTS = { none: 0, low: 0.5, normal: 1, high: 2 };
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
    // VIP points count in the deal % fit (false: worth 0, the rest of a pack carries its price) (Settings).
    vipPointsInWorth: false,
    // Events and passes follow the calendar on every page load (setup bar switch; a change by hand turns it off).
    followsCalendar: true,
    // A browser notification when a new round of Survival Battle begins, while a tab of the app is open (Settings).
    notifySurvivalBattle: false,
    extraCurrency: {}, // currencyId -> units per week from outside the packs: set per shop without event (Events page), counts on every page
    extraEventBanknotes: {}, // eventId -> extra Banknotes per week spent first on that event's packs, counts on every page (Events page)
    skippedPackages: {}, // packageId -> the first game day its skip no longer applies (Deal Ranking's "Skip", core/skips.js)
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

/** `{ itemId: factor }` for the valuation (items at "normal" are left out). */
function priorityWeights(settings) {
    return Object.fromEntries(
        Object.entries(settings.priorities || {}).map(([id, level]) => [id, PRIORITY_WEIGHTS[level] ?? 1]),
    );
}

/**
 * Solver options for the weekly plan of `settings` (also used for what-if budgets). `today`: the game day (for how
 * long a skip lasts), `basePoints`: the deal % fit's points (point-fit.js, for the settings' `zeroFitItems`);
 * `overrides` win over everything.
 */
function planOptions(settings, { today, basePoints }, overrides = {}) {
    return {
        budget: settings.budget,
        activeEventIds: new Set(settings.activeEvents),
        seasonalPasses: settings.seasonalPasses,
        // "Must buy" shop offers shape the one plan on every page.
        lockedOffers: settings.lockedOffers,
        // Extra Banknotes an event's packs (and so its locked offers) are paid from first, on top of the weekly spend.
        extraEventBanknotes: settings.extraEventBanknotes,
        // Packs the user skipped on the Deal Ranking (not bought, nor the higher tiers that need them).
        skippedPackages: activeSkips(settings.skippedPackages, today),
        // Currency from outside the packs ("Extra ... per week" of a shop without event, Events page).
        extraCurrency: settings.extraCurrency,
        includePasses: true,
        includeExclusives: false,
        weights: priorityWeights(settings),
        basePoints,
        ...overrides,
    };
}

export {
    DEFAULT_NONE_ITEMS,
    DEFAULT_SETTINGS,
    MINE_SAFETY_LEVELS,
    PRIORITY_LEVELS,
    planOptions,
    priorityWeights,
    zeroFitItems,
};

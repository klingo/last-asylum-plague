/**
 * The Raven Epigraph page: what the player has of the Raven's UR epigraphs and how many chests it takes to max them.
 *
 * - The Raven has three plans (Warrior, Ranger, Warlock), each the same four epigraphs (`EPIGRAPHS`, in the order the game
 *   places them), so 12 items: `<epigraph>_iv_<faction>` in `data/pack_data.json` (`epigraphItemId`).
 * - An epigraph has a promotion level from 0 to 6 (`MAX_LEVEL`). The promotion from level n to n+1 takes `PROMOTE_COPIES[n]`
 *   copies (1, 2, 3, 5, 7, 10: 28 in all). The copies on hand count towards what the remaining levels cost
 *   (`copiesNeeded`); a copy of an epigraph that is maxed, or beyond what it still needs, is wasted.
 * - Copies come from chests. A UR Epigraph Chest gives a random UR epigraph (any of the 12 with the same chance), a SSR
 *   Epigraph Chest does so 15 % of the time and a SR Epigraph Chest 2 % of the time; all of them also give UR Epigraph
 *   Shards (fewer from the lower ones), and 800 shards craft an epigraph of choice. A UR Epigraph Choice Chest gives one of choice. `chestDrops` reads all of that from the data.
 * - The chests and shards on hand are used last, to fill the gaps the random drops leave (`gapsCovered`). `chestEstimate`
 *   says how many chests of one kind it takes before they do: a simulation (`simulateChests`) opens them one by one, the
 *   answer is the mean over many runs and the count that 9 runs in 10 stay within. Its random numbers are seeded, so the
 *   answer is the same on every look.
 * - The saved state is `{ epigraphs: { <item id>: { level, copies } }, choiceChests, shards, evolveLevel }`; what isn't saved is 0
 *   (`evolveLevel`, the Raven Evolve level of the epigraph texts: core/epigraph-effect.js).
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */
import { clampLevel } from './hero-stars.js';

const EPIGRAPHS = ['frenzied_flock', 'protective_charm', 'reversal_power', 'guard_of_nature'];
// In this order on the page (Warriors, Rangers, Warlocks).
const EPIGRAPH_FACTIONS = ['warrior', 'ranger', 'warlock'];
// The copies the promotion from level n to n+1 takes.
const PROMOTE_COPIES = [1, 2, 3, 5, 7, 10];
const MAX_LEVEL = PROMOTE_COPIES.length;

const UR_EPIGRAPH = 'ur_epigraph';
const SHARD = 'ur_epigraph_shard';
const CHOICE_CHEST = 'ur_epigraph_choice_chest';
// The chests that are bought, by the kind the page asks about.
const CHESTS = { ur: 'ur_epigraph_chest', ssr: 'ssr_epigraph_chest', sr: 'sr_epigraph_chest' };

// A count the player enters can't be more than this (it only keeps the numbers whole).
const MAX_COUNT = 1e9;
// The simulation: how many times the chests are opened until the gaps are filled, and the share of runs the "safe" count covers.
const RUNS = 2000;
const SAFE_SHARE = 0.9;

/** The data id of an epigraph of a plan: `guard_of_nature_iv_warrior`. */
const epigraphItemId = (epigraph, faction) => `${epigraph}_iv_${faction}`;

/** Every epigraph's item id: the plans one after the other, each in the order of `EPIGRAPHS`. */
const EPIGRAPH_ITEM_IDS = EPIGRAPH_FACTIONS.flatMap((faction) =>
    EPIGRAPHS.map((epigraph) => epigraphItemId(epigraph, faction)),
);

/** A count (shards, chests, copies) as a whole number from 0 up. */
const clampCount = (value) => clampLevel(value, MAX_COUNT);

/** The copies the promotion from this level takes, null for an epigraph that is maxed. */
const nextPromotion = (level) => PROMOTE_COPIES[level] ?? null;

/** What an epigraph at `level` with `copies` on hand still needs to reach the highest level (never below 0). */
function copiesNeeded(level, copies) {
    const cost = PROMOTE_COPIES.slice(level).reduce((sum, step) => sum + step, 0);
    return Math.max(cost - copies, 0);
}

/** An epigraph's `{ level, copies }` from the saved state; 0 for what isn't saved. */
function epigraphLevel(saved, itemId) {
    const entry = saved?.epigraphs?.[itemId];
    return { level: clampLevel(entry?.level, MAX_LEVEL), copies: clampCount(entry?.copies) };
}

/** The UR Epigraph Choice Chests and UR Epigraph Shards on hand (`field`: 'choiceChests' or 'shards'). */
const stockOf = (saved, field) => clampCount(saved?.[field]);

/**
 * The copies each of the 12 epigraphs still needs (`EPIGRAPH_ITEM_IDS` order); `plans` are the plans that count (the
 * unlocked ones), the epigraphs of the others need nothing.
 */
function epigraphGaps(saved, plans = EPIGRAPH_FACTIONS) {
    return EPIGRAPH_FACTIONS.flatMap((faction) =>
        EPIGRAPHS.map((epigraph) => {
            if (!plans.includes(faction)) {
                return 0;
            }
            const { level, copies } = epigraphLevel(saved, epigraphItemId(epigraph, faction));
            return copiesNeeded(level, copies);
        }),
    );
}

/**
 * What a chest gives, read from the item: the chance that it holds a UR epigraph (the `ur_epigraph` rows of its
 * `drop_table`, or 1 for a fixed `contains`) and its shards (the average over its rows). A chest the data doesn't know
 * gives nothing.
 */
function chestOutcome(item) {
    const rows = item?.drop_table ?? (item?.contains ? [{ contains: item.contains, probability: 1 }] : []);
    let urChance = 0;
    let shards = 0;
    for (const row of rows) {
        urChance += (row.contains?.[UR_EPIGRAPH] ? 1 : 0) * row.probability;
        shards += (row.contains?.[SHARD] ?? 0) * row.probability;
    }
    return { urChance, shards };
}

/**
 * Everything the estimate reads from the data: what each kind of chest gives (`chests`: `{ urChance, shards }` by `CHESTS`
 * kind), the shards a choice chest gives besides its epigraph, and the shards a craft takes.
 */
function chestDrops(data) {
    const items = data.items ?? {};
    const choices = items[CHOICE_CHEST]?.choice?.choices ?? [];
    return {
        chests: Object.fromEntries(Object.entries(CHESTS).map(([kind, id]) => [kind, chestOutcome(items[id])])),
        choiceShards: choices[0]?.[SHARD] ?? 0,
        craftShards: items[EPIGRAPH_ITEM_IDS[0]]?.crafted_from?.[SHARD] ?? Infinity,
    };
}

/**
 * How many of `missing` copies the choice chests and the shards on hand fill: a choice chest fills one (and gives its
 * shards), then every `craftShards` shards craft another.
 */
function coveredCopies(missing, choiceChests, shards, drops) {
    const chosen = Math.min(choiceChests, missing);
    const crafted = Math.floor((shards + chosen * drops.choiceShards) / drops.craftShards);
    return Math.min(chosen + crafted, missing);
}

/** Whether the choice chests and the shards on hand fill all `missing` copies. */
const gapsCovered = (missing, choiceChests, shards, drops) =>
    coveredCopies(missing, choiceChests, shards, drops) >= missing;

/** A seeded random number generator (mulberry32): the same seed gives the same numbers. */
function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * How many chests of a kind it takes until the shards alone fill `missing` copies, with `shards` on hand and `chestShards`
 * from each chest (0 when they already do, Infinity for a chest without shards).
 */
function chestsForShards(missing, shards, chestShards, stock, drops) {
    const chosen = Math.min(stock.choiceChests, missing);
    const rest = missing - chosen;
    if (rest === 0) {
        return 0;
    }
    const need = rest * drops.craftShards - chosen * drops.choiceShards - shards;
    return need <= 0 ? 0 : Math.ceil(need / chestShards);
}

/**
 * How many chests of one `kind` (`CHESTS`) it takes until what is on hand fills the gaps: `gaps` the copies each epigraph
 * still needs, `stock` the `{ choiceChests, shards }` on hand. A run opens chests (each adds its shards, and with its chance a
 * copy of one of the epigraphs, which counts only where one is still needed) until `gapsCovered`. It doesn't open them one by
 * one: the chests up to the next copy are drawn at once (a geometric number), and it stops when the shards alone would fill
 * the gaps before that copy comes, so a run takes about as many steps as it has copies, not chests. Gives
 * `{ expected, safe }`, the mean over `runs` runs and the count that `SAFE_SHARE` of them stay within, both rounded up (0
 * when the stock already covers it), or null for a chest that gives nothing.
 */
function simulateChests(gaps, kind, stock, drops, { runs = RUNS, seed = 1 } = {}) {
    const chest = drops.chests[kind];
    const total = gaps.reduce((sum, gap) => sum + gap, 0);
    if (gapsCovered(total, stock.choiceChests, stock.shards, drops)) {
        return { expected: 0, safe: 0 };
    }
    if (!chest || (chest.urChance <= 0 && chest.shards <= 0)) {
        return null;
    }
    const random = seededRandom(seed);
    const opened = [];
    for (let run = 0; run < runs; run++) {
        const left = [...gaps];
        let missing = total;
        let shards = stock.shards;
        let count = 0;
        for (;;) {
            const toFill = chestsForShards(missing, shards, chest.shards, stock, drops);
            const toCopy =
                chest.urChance >= 1
                    ? 1
                    : chest.urChance > 0
                      ? Math.max(1, Math.ceil(Math.log(1 - random()) / Math.log(1 - chest.urChance)))
                      : Infinity;
            if (toFill <= toCopy) {
                count += toFill;
                break;
            }
            count += toCopy;
            shards += toCopy * chest.shards;
            const index = Math.floor(random() * left.length);
            if (left[index] > 0) {
                left[index]--;
                missing--;
            }
        }
        opened.push(count);
    }
    opened.sort((a, b) => a - b);
    const mean = opened.reduce((sum, count) => sum + count, 0) / runs;
    return { expected: Math.ceil(mean), safe: opened[Math.ceil(runs * SAFE_SHARE) - 1] };
}

/**
 * The page's answer for a saved state: the copies still `missing` over the epigraphs of the `plans` that count (all three
 * unless given: the unlocked ones; a random copy that lands on a locked plan's epigraph is wasted), how many of them the
 * choice chests and shards on hand fill (`covered`), and per kind of chest (`ur`, `ssr`, `sr`) what `simulateChests` says
 * it takes. `options` are those of `simulateChests`.
 */
function chestEstimate(data, saved, { plans, ...options } = {}) {
    const drops = chestDrops(data);
    const gaps = epigraphGaps(saved, plans);
    const stock = { choiceChests: stockOf(saved, 'choiceChests'), shards: stockOf(saved, 'shards') };
    const missing = gaps.reduce((sum, gap) => sum + gap, 0);
    return {
        missing,
        covered: coveredCopies(missing, stock.choiceChests, stock.shards, drops),
        ...Object.fromEntries(
            Object.keys(CHESTS).map((kind) => [kind, simulateChests(gaps, kind, stock, drops, options)]),
        ),
    };
}

export {
    CHESTS,
    CHOICE_CHEST,
    EPIGRAPHS,
    EPIGRAPH_FACTIONS,
    EPIGRAPH_ITEM_IDS,
    MAX_COUNT,
    MAX_LEVEL,
    PROMOTE_COPIES,
    SHARD,
    chestDrops,
    chestEstimate,
    clampCount,
    copiesNeeded,
    epigraphGaps,
    epigraphItemId,
    epigraphLevel,
    gapsCovered,
    nextPromotion,
    simulateChests,
    stockOf,
};

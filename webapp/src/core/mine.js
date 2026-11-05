/**
 * Dig events (`mines` in pack_data.json, e.g. the Dwarven Mine): how many digs a floor takes on average, and
 * what the normal tiles give on the way. Valuing the rewards is up to the caller (planner.js).
 *
 * A floor has `tiles_per_floor` tiles: one special tile (the wish reward; finding it clears the floor) and
 * normal tiles. Each dig uncovers one hidden tile, picked by weight: every normal tile weighs `normal_weight`,
 * the special tile `special_weights` (rising with the digs done on the floor). After `pity[last digit of the
 * floor]` digs the next one surely finds it. All averages are expected values; a real run is luckier or not.
 *
 * Unused pickaxes carry over to the next run, the floors don't: a run is only worth digging if it reaches the
 * last progress reward (`targetFloor`), else the pickaxes are better kept for a later run.
 */

/** The last progress-reward floor (the one a run should reach), or 0 without progress rewards. */
function targetFloor(mine) {
    return Math.max(
        0,
        ...Object.keys(mine.progress_rewards || {})
            .map(Number)
            .filter((floor) => floor <= mine.floors),
    );
}

/**
 * Free pickaxes in the `days` left of the run: `free_currency_per_day`, plus `purchase_bonus_per_day` on days
 * with a pack bought (`withBonus`). `{ perDay, bonusPerDay, days, total }` (bonusPerDay 0 without the bonus).
 */
function freeCurrency(mine, { days, withBonus }) {
    const perDay = mine.free_currency_per_day || 0;
    const bonusPerDay = withBonus ? mine.purchase_bonus_per_day || 0 : 0;
    return { perDay, bonusPerDay, days, total: (perDay + bonusPerDay) * days };
}

/** Weight of the special tile after `digsDone` digs on the floor: the largest `special_weights` key <= it. */
function specialWeight(mine, digsDone) {
    let weight = 0;
    let from = -1;
    for (const [key, value] of Object.entries(mine.special_weights || {})) {
        const at = Number(key);
        if (at <= digsDone && at > from) {
            from = at;
            weight = value;
        }
    }
    return weight;
}

/**
 * How many digs floor `floor` (1-based) takes: `chances[k]` = the chance it takes exactly k digs (the wish found
 * with dig k). A chain over the digs done, all of them normal tiles so far.
 */
function digsDistribution(mine, floor) {
    const normals = mine.tiles_per_floor - 1;
    const pity = mine.pity?.[String(floor % 10)] ?? normals;
    const chances = [0];
    let notYet = 1; // chance the wish wasn't found in the digs so far
    for (let done = 0; done <= normals && notYet > 0; done++) {
        const special = specialWeight(mine, done);
        const hidden = mine.normal_weight * (normals - done);
        const found = done >= pity || hidden <= 0 ? 1 : special / (special + hidden);
        chances.push(notYet * found);
        notYet *= 1 - found;
    }
    return chances;
}

/**
 * Expected digs to clear floor `floor` (1-based): `{ digs, normalDigs }` (normalDigs = digs - 1, the normal
 * tiles uncovered before the wish).
 */
function expectedDigs(mine, floor) {
    const digs = digsDistribution(mine, floor).reduce((sum, chance, k) => sum + chance * k, 0);
    return { digs, normalDigs: digs - 1 };
}

/**
 * How safe the expected pickaxes for floors `fromFloor`..`toFloor` are: the exact distribution of the run's total
 * digs (the floors' dig counts added up). `{ mean, min, max, chanceEnough(pickaxes), atLeast(chance) }`: min / max
 * = the luckiest / unluckiest run, chanceEnough = the chance that many pickaxes suffice, atLeast = the pickaxes
 * that suffice with that chance.
 */
function pickaxeOdds(mine, fromFloor, toFloor) {
    let total = [1];
    for (let floor = fromFloor; floor <= toFloor; floor++) {
        const floorChances = digsDistribution(mine, floor);
        const next = new Array(total.length + floorChances.length - 1).fill(0);
        total.forEach((a, i) => floorChances.forEach((b, k) => (next[i + k] += a * b)));
        total = next;
    }
    const cumulative = [];
    total.reduce((sum, chance, k) => (cumulative[k] = sum + chance), 0);
    const possible = total.map((chance, k) => (chance > 0 ? k : null)).filter((k) => k !== null);
    return {
        mean: total.reduce((sum, chance, k) => sum + chance * k, 0),
        min: possible[0] ?? 0,
        max: possible[possible.length - 1] ?? 0,
        chanceEnough: (pickaxes) =>
            pickaxes >= cumulative.length - 1 ? 1 : pickaxes < 0 ? 0 : cumulative[Math.floor(pickaxes)],
        atLeast: (chance) => {
            const k = cumulative.findIndex((c) => c >= chance - 1e-12);
            return k === -1 ? cumulative.length - 1 : k;
        },
    };
}

/** How many floors after `startFloor` `pickaxes` clear at the expected digs (whole floors, up to the top). */
function floorsFor(mine, startFloor, pickaxes) {
    let left = pickaxes;
    let floor = startFloor;
    while (floor < mine.floors) {
        const { digs } = expectedDigs(mine, floor + 1);
        if (digs > left + 1e-9) {
            break;
        }
        left -= digs;
        floor++;
    }
    return floor - startFloor;
}

/**
 * Floors `startFloor`+1..`floors` (`startFloor`: the floors already cleared this run) split after every
 * progress-reward floor: `[{ from, to, floors, pickaxes, normalDigs, reward }]`, where `pickaxes` /
 * `normalDigs` are the segment's expected totals and `reward` the progress reward for clearing floor `to`
 * (null for the last segment without one).
 */
function mineSegments(mine, startFloor = 0) {
    if (startFloor >= mine.floors) {
        return [];
    }
    const ends = Object.keys(mine.progress_rewards || {})
        .map(Number)
        .filter((floor) => floor > startFloor && floor <= mine.floors)
        .sort((a, b) => a - b);
    if (ends[ends.length - 1] !== mine.floors) {
        ends.push(mine.floors);
    }
    const segments = [];
    let from = startFloor + 1;
    for (const to of ends) {
        let pickaxes = 0;
        let normalDigs = 0;
        for (let floor = from; floor <= to; floor++) {
            const expected = expectedDigs(mine, floor);
            pickaxes += expected.digs;
            normalDigs += expected.normalDigs;
        }
        segments.push({
            from,
            to,
            floors: to - from + 1,
            pickaxes,
            normalDigs,
            reward: mine.progress_rewards?.[String(to)] || null,
        });
        from = to + 1;
    }
    return segments;
}

/**
 * Expected loot of `normalDigs` normal tiles: every normal tile is uncovered equally often, so each of the
 * `normal_rewards` counts `normalDigs / normal tiles` times. A tile without a reward gives nothing.
 * Returns `{ itemId: qty }` (fractional).
 */
function normalRewardBundle(mine, normalDigs) {
    const share = normalDigs / (mine.tiles_per_floor - 1);
    const bundle = {};
    for (const reward of mine.normal_rewards || []) {
        for (const [itemId, qty] of Object.entries(reward)) {
            bundle[itemId] = (bundle[itemId] || 0) + qty * share;
        }
    }
    return bundle;
}

/**
 * The pickaxes owned and the floor reached, from what the user stored for the mine (`{ pickaxes, floor, run }`):
 * the floor only counts for the run it was entered for (`run`: the run's start day; the floors start again).
 */
function mineProgressFor(stored, run) {
    return {
        owned: stored?.pickaxes || 0,
        floor: stored && run && stored.run === run.start ? stored.floor || 0 : 0,
    };
}

/**
 * The last digits of a floor number grouped by their pity (digs after which the special tile is sure), as the
 * mine's rules list them (…1 / …6: 5 digs): `[{ pity, digits, averageDigs }]` in the order of first appearance
 * (1 to 9, then 0).
 */
function pityGroups(mine) {
    const normals = mine.tiles_per_floor - 1;
    const byPity = new Map();
    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
        const pity = mine.pity?.[String(digit)] ?? normals;
        byPity.set(pity, [...(byPity.get(pity) || []), digit]);
    }
    return [...byPity].map(([pity, digits]) => ({
        pity,
        digits,
        averageDigs: expectedDigs(mine, digits[0] || 10).digs,
    }));
}

/**
 * What the mine's floors cost and give from the floor reached: one row per stretch up to a progress reward (worth = a
 * wish per floor (the best for you), the normal loot and the progress reward; cost = what its pickaxes cost in the
 * packs on sale, floor by floor from the bottom: the owned and free pickaxes first, then the cheapest pack per
 * pickaxe within the limits of the days left, whole pack prices (see catalog.js `currencyCost`), else at their
 * worth). The floors above the target floor follow (`segment.aboveTarget`: never dug, no progress reward). Also the
 * pickaxes this run (`have`: owned, free, from the plan's packs), what the target floor needs (on average, and
 * `odds`: how safe that is, see pickaxeOdds) and what the packs could still give.
 * `dug`: the mine's entry of the plan; `pricing`: `pickaxeWorth` (Banknote worth of one pickaxe), `bundleWorth(contents)`
 * (Banknote worth of an item bundle), `coin` (the plan's `currencies` entry of the pickaxes) and `packCost(bought)`
 * (`currencyCost` of that many pickaxes from the packs on sale, or null).
 */
function mineEconomics(dug, { pickaxeWorth, bundleWorth, coin, packCost }) {
    const { mine } = dug;
    const wishWorths = mine.wish_rewards.map((reward) => bundleWorth(reward));
    const bestWish = Math.max(0, ...wishWorths);
    // Banknotes for the first `pickaxes` pickaxes from the floor reached (the owned and free ones cost nothing).
    const costUpTo = (pickaxes) => {
        const bought = Math.max(0, pickaxes - dug.owned - dug.free.total);
        const cost = packCost(bought);
        return cost ? cost.banknotes : bought * pickaxeWorth;
    };
    // The floors above the target floor: listed with their worth and ratio, but never dug (planner.js).
    const above =
        dug.target > 0
            ? mineSegments(mine, Math.max(dug.startFloor, dug.target)).map((segment) => ({
                  ...segment,
                  cleared: 0,
                  aboveTarget: true,
              }))
            : [];
    let pickaxesBelow = 0;
    const rows = [...dug.segments, ...above].map((segment) => {
        const loot = bundleWorth(normalRewardBundle(mine, segment.normalDigs));
        const reward = segment.reward ? bundleWorth(segment.reward) : 0;
        const worth = loot + segment.floors * bestWish + reward;
        const cost = costUpTo(pickaxesBelow + segment.pickaxes) - costUpTo(pickaxesBelow);
        pickaxesBelow += segment.pickaxes;
        return { segment, worth, cost, ratio: cost > 0 ? worth / cost : null };
    });
    const toTarget = rows.filter(({ segment }) => segment.to <= dug.target);
    const have = (coin?.received ?? 0) + (coin?.extra ?? 0);
    const needed = toTarget.reduce((sum, { segment }) => sum + segment.pickaxes, 0);
    return {
        rows,
        wishWorths,
        have,
        odds: dug.target > dug.startFloor ? pickaxeOdds(mine, dug.startFloor + 1, dug.target) : null,
        fromPacks: coin?.received ?? 0,
        spent: coin?.spent ?? 0,
        needed,
        worthToTarget: toTarget.reduce((sum, row) => sum + row.worth, 0),
        costToTarget: costUpTo(needed) - costUpTo(have),
        // Most pickaxes the packs give this run within their limits for the days left.
        available: packCost(0)?.available ?? 0,
    };
}

export {
    targetFloor,
    freeCurrency,
    expectedDigs,
    pickaxeOdds,
    floorsFor,
    mineSegments,
    normalRewardBundle,
    mineProgressFor,
    pityGroups,
    mineEconomics,
};

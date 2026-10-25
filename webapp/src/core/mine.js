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

export {
    targetFloor,
    freeCurrency,
    digsDistribution,
    expectedDigs,
    pickaxeOdds,
    floorsFor,
    mineSegments,
    normalRewardBundle,
};

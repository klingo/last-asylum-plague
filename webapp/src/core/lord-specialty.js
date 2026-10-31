/**
 * A lord's talent (specialty skill) build (`data/lord_specialty.json`, Lord Specialty page): what it needs (the
 * Specialty level and extra Specialty Skill Points), what's left of the player's points, whether a talent can take
 * one more point, and the build as a short URL text.
 *
 * - A build is the level of every talent of the lord, in the data's order (0 = not taken).
 * - Every Specialty level gives 1 point, skill books give extra points; every talent level costs 1 point. A talent
 *   unlocks at its `unlock_level`, so a build needs the highest unlock level of its talents, and its points.
 * - Talents above the season's `max_level` (Lv.45/50, "not in the current season") can't take points.
 * - A setup is the player's `{ level, extra }`: their Specialty level and their extra points.
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */

/** A build without any points. */
function emptyBuild(lord) {
    return lord.talents.map(() => 0);
}

function spentPoints(build) {
    return build.reduce((sum, points) => sum + points, 0);
}

/** True for a talent no Specialty level of this season unlocks (Lv 45/50 "not in the current season"). */
function isOutOfSeason(talent, maxLevel) {
    return talent.unlock_level > maxLevel;
}

/** True for a talent the player's Specialty `level` doesn't unlock (yet), or that's not in this season. */
function isLocked(talent, level, maxLevel) {
    return talent.unlock_level > Math.min(level, maxLevel);
}

/**
 * Why talent `index` can't take one more point at the player's `level`: 'outOfSeason', 'locked' (level too low) or
 * 'maxed'; null if it can.
 */
function raiseBlock(lord, build, index, level, maxLevel) {
    const talent = lord.talents[index];
    if (isOutOfSeason(talent, maxLevel)) {
        return 'outOfSeason';
    }
    if (isLocked(talent, level, maxLevel)) {
        return 'locked';
    }
    return build[index] >= talent.max_level ? 'maxed' : null;
}

/** The build with talent `index` one point higher (or lower with `delta` -1), clamped to 0 … max_level. */
function changeTalent(lord, build, index, delta) {
    const next = [...build];
    next[index] = Math.max(0, Math.min(lord.talents[index].max_level, next[index] + delta));
    return next;
}

/**
 * What a build needs: `spent` points, the Specialty `level` that unlocks its talents and gives as many of its points
 * as the season allows, and the extra points for the rest (only beyond `maxLevel`). `unlockLevel` is the highest
 * unlock level of its talents. An empty build needs level 0.
 */
function requirements(lord, build, maxLevel) {
    const spent = spentPoints(build);
    const unlockLevel = Math.max(
        0,
        ...lord.talents.filter((talent, index) => build[index] > 0).map((talent) => talent.unlock_level),
    );
    const level = Math.max(unlockLevel, Math.min(spent, maxLevel));
    return { spent, unlockLevel, level, extra: Math.max(0, spent - level) };
}

/** The player's points not spent by the build (negative: the build needs more than they have). */
function pointsLeft(build, { level, extra }) {
    return level + extra - spentPoints(build);
}

/** True when the player can have the build: their level unlocks its talents and their points pay for it. */
function isReachable(lord, build, setup) {
    const { unlockLevel } = requirements(lord, build, setup.level);
    return unlockLevel <= setup.level && pointsLeft(build, setup) >= 0;
}

/** The value of a talent at its level 1 … max_level (`values`), or null for talents without values. */
function talentValue(talent, level) {
    return talent.values && level >= 1 ? talent.values[Math.min(level, talent.values.length) - 1] : null;
}

/** The build as URL text: one digit per talent in the data's order, the trailing zeros dropped ("5050003"). */
function encodeBuild(build) {
    return build.join('').replace(/0+$/, '');
}

/**
 * A build from its URL text: missing or bad digits count 0, levels above a talent's max_level are capped, and talents
 * out of season get none.
 */
function decodeBuild(lord, text, maxLevel) {
    const digits = String(text ?? '');
    return lord.talents.map((talent, index) => {
        const points = Number.parseInt(digits[index], 10);
        return Number.isFinite(points) && !isOutOfSeason(talent, maxLevel) ? Math.min(points, talent.max_level) : 0;
    });
}

/** The tree's rows: per unlock level (ascending) its talents with their index in the build. */
function talentRows(lord) {
    const rows = new Map();
    lord.talents.forEach((talent, index) => {
        if (!rows.has(talent.unlock_level)) {
            rows.set(talent.unlock_level, []);
        }
        rows.get(talent.unlock_level).push({ talent, index });
    });
    return [...rows].sort(([a], [b]) => a - b).map(([level, talents]) => ({ level, talents }));
}

export {
    emptyBuild,
    spentPoints,
    isOutOfSeason,
    isLocked,
    raiseBlock,
    changeTalent,
    requirements,
    pointsLeft,
    isReachable,
    talentValue,
    encodeBuild,
    decodeBuild,
    talentRows,
};

/**
 * What the player has of a hero (My Heroes page): its stars, its weapon's stars and its awakening level, the limits, how
 * the stars are drawn, and which frame the awakening gives the portrait.
 *
 * - A hero has 0-10 stars, a hero with an exclusive weapon (`weapon` in `data/hero_skills.json`) a weapon with 0-10
 *   stars too. Only whole stars are kept (the game counts in steps of 0.2). An awakenable hero has an awakening level
 *   (its highest is the last of `awakening_caps` in `data/hero_skills.json`), but only a hero with 10 stars can be
 *   awakened: below that its awakening level counts as 0 (what was entered is kept for when it has them).
 * - Five icons show the stars: up to 5 stars, that many yellow ones (the rest empty); from 6 stars on, the yellow
 *   ones turn red: (stars - 5) red ones, the rest empty. The files are in assets/gear/stars.
 * - From awakening level 1, 10, 20, 30 and 40 on, the portrait gets a frame of its own instead of the faction-coloured
 *   border (assets/heroes/frames/awakening_<level>.png, `AWAKENING_FRAMES`). From level 40 the portrait itself is
 *   another picture too (assets/heroes/awakened/<image>.png, `hasAwakenedPortrait`).
 * - The saved level is `{ heroes: { <hero id>: { stars, weapon, awakening } } }`; what isn't saved is 0.
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */

const MAX_STARS = 10;
const MAX_WEAPON_STARS = 10;
// The stars a hero needs before it can be awakened.
const AWAKENING_MIN_STARS = 10;
// How many icons show the stars: the yellow ones fill up at this many stars, then the red ones take over.
const STAR_ICON_COUNT = 5;
// The icons (file names in assets/gear/stars, without ".png"): a yellow star, a red one, an empty one.
const YELLOW_STAR = '5_5_ur';
const RED_STAR = '5_5_mr';
const EMPTY_STAR = '0_5';
// The awakening levels at which the portrait's frame changes.
const AWAKENING_FRAMES = [1, 10, 20, 30, 40];
// From this awakening level on, a hero's portrait is its awakened picture.
const AWAKENED_PORTRAIT_LEVEL = 40;

/** A level (stars, awakening) as a whole number from 0 to `max` (anything that isn't a number is 0). */
function clampLevel(value, max = MAX_STARS) {
    return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), max) : 0;
}

/** The five icons of `stars`: yellow ones up to 5 stars, red ones above, the empty ones after them. */
function starIcons(stars) {
    const red = stars > STAR_ICON_COUNT;
    const filled = red ? stars - STAR_ICON_COUNT : stars;
    return Array.from({ length: STAR_ICON_COUNT }, (_, i) =>
        i < filled ? (red ? RED_STAR : YELLOW_STAR) : EMPTY_STAR,
    );
}

/** The frame of a portrait at this awakening level: the highest of `AWAKENING_FRAMES` it reaches, null below the first. */
function awakeningFrame(awakening) {
    return AWAKENING_FRAMES.findLast((level) => awakening >= level) ?? null;
}

/** Whether a hero at this awakening level shows its awakened portrait. */
const hasAwakenedPortrait = (awakening) => awakening >= AWAKENED_PORTRAIT_LEVEL;

/**
 * A hero's `{ stars, weapon, awakening }` from the saved level (`heroes` by hero id); 0 for what isn't saved, and an
 * awakening level of 0 while the hero has fewer than `AWAKENING_MIN_STARS` stars.
 */
function heroLevel(saved, heroId) {
    const entry = saved?.heroes?.[heroId];
    const stars = clampLevel(entry?.stars);
    return {
        stars,
        weapon: clampLevel(entry?.weapon, MAX_WEAPON_STARS),
        awakening: stars >= AWAKENING_MIN_STARS ? clampLevel(entry?.awakening, Infinity) : 0,
    };
}

export {
    AWAKENING_FRAMES,
    AWAKENING_MIN_STARS,
    MAX_STARS,
    MAX_WEAPON_STARS,
    YELLOW_STAR,
    awakeningFrame,
    clampLevel,
    hasAwakenedPortrait,
    heroLevel,
    starIcons,
};

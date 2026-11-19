/**
 * What a Raven epigraph does, as the Raven Epigraph page shows it on the card of an epigraph (data/raven_epigraphs.json,
 * schema data/raven_epigraphs.schema.json).
 *
 * - An epigraph of a plan has a text with {numbers}: the numbers of `values` depend on its promotion level (the list has
 *   an entry for level 0 to 6), the numbers of `bonus_values` on the boost of the player's Raven Evolve level. The bonus is
 *   the part after the plus in the game's text ("3.2M+500K").
 * - The Raven Evolve level is 0 to `evolve_max_level`; its boost is how many of `evolve_boost_levels` it has reached
 *   (150, 300, ... : 0 to 5), and it unlocks the plans (`plan_unlock_levels`: 10, 150 and 300). It is saved with the rest
 *   of the page as `evolveLevel`; where it isn't saved yet it is 0, so no plan is unlocked.
 * - `describeEpigraph` fills the text like a skill's (`describeSkill` in skill-path.js): parts, with the number at the
 *   promotion level, null where a number isn't known yet. A number with a bonus right behind it (a plus) is one part, as the
 *   game shows "3.2M+500K": the page shows the bonus in its own colour.
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */
import { describeSkill } from './skill-path.js';

/** A Raven Evolve level as a whole number from 0 to the highest (anything that isn't a number is 0). */
function clampEvolve(raven, value) {
    return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), raven.evolve_max_level) : 0;
}

/** The Raven Evolve level in the saved state (0 where it isn't). */
const evolveLevelOf = (raven, saved) => clampEvolve(raven, saved?.evolveLevel);

/** The boost a Raven Evolve level gives: how many of `evolve_boost_levels` it has reached. */
const evolveBoost = (raven, evolveLevel) => raven.evolve_boost_levels.filter((level) => evolveLevel >= level).length;

/** Whether a Raven Evolve level has unlocked a plan (a plan the data has no level for is always unlocked). */
const planUnlocked = (raven, faction, evolveLevel) => evolveLevel >= (raven.plan_unlock_levels?.[faction] ?? 1);

/** The entry of an epigraph in a plan, or null while the data doesn't have it yet. */
const effectEntry = (raven, epigraph, faction) => raven.epigraphs?.[epigraph]?.[faction] ?? null;

/**
 * The parts of an entry's `text` (its description in one language) at a promotion `level` and Raven Evolve `boost`:
 * strings and `{ sign, now, unit, bonus }` for each number (`describeSkill`), where `bonus` is `{ now, unit }` for
 * the number behind it with a plus (`now` 0 before the first boost, null where it isn't known) and null for a number
 * without one.
 */
function describeEpigraph(entry, text, level, boost) {
    const values = { ...entry.values };
    for (const [name, list] of Object.entries(entry.bonus_values ?? {})) {
        values[name] = list[boost] ?? null;
    }
    const parts = describeSkill(text, values, level, level, 0);
    const grouped = [];
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const bonus = parts[i + 1];
        if (typeof part === 'string') {
            grouped.push(part);
        } else if (typeof bonus === 'object' && bonus.sign === '+') {
            grouped.push({
                sign: part.sign,
                now: part.now,
                unit: part.unit,
                bonus: { now: bonus.now, unit: bonus.unit },
            });
            i++;
        } else {
            grouped.push({ sign: part.sign, now: part.now, unit: part.unit, bonus: null });
        }
    }
    return grouped;
}

export { clampEvolve, describeEpigraph, effectEntry, evolveBoost, evolveLevelOf, planUnlocked };

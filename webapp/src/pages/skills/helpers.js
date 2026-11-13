/**
 * Names, icons and small markup pieces shared by the board, the guide and the help.
 */
import { enumLabel, localizedName } from '../../ui/i18n.js';
import { BASE_URL } from '../../ui/base-url.js';
import { escapeHtml } from '../../ui/html.js';
import { heroImage as heroImageOf, heroName as heroNameOf } from '../../ui/hero-parts.js';
import { ctx } from './state.js';

const ICONS = `${BASE_URL}assets/heroes/skills/`;
// The filled star of the gear pages, after the star a bonus unlocks at.
const STAR_ICON = `${BASE_URL}assets/gear/stars/5_5_ur.png`;
// The icons of the buttons, as on the buttons themselves and in "How it works".
const ACTION_ICONS = { done: '✓', undo: '↶', startOver: '↺' };

const heroName = (heroId) => heroNameOf(ctx.data.heroes, heroId);
const heroImage = (heroId) => heroImageOf(ctx.data.heroes, heroId);
const heroClass = (heroId) => ctx.data.heroes?.[heroId]?.class;
/** The heroes of the shown faction in the guide's order (the order they are levelled in). */
const factionHeroes = () => ctx.skills.order[ctx.shownFaction] || [];
/**
 * The heroes of the shown faction as the squad stands, left to right: the two tanks, then carry, support, carry (the
 * slots of the first squad guide of the pack data, as on the Gear Upgrade Path page).
 */
function boardHeroes() {
    const heroes = factionHeroes();
    const guide = Object.values(ctx.data.squad_guides || {})[0];
    const standing = guide
        ? [...guide.formation.front, ...guide.formation.back].map(
              (slot) => guide.slots[slot]?.heroes?.[ctx.shownFaction],
          )
        : [];
    return standing.length === heroes.length && heroes.every((hero) => standing.includes(hero)) ? standing : heroes;
}
/** A hero's skill in a slot; the 8-star skill is the same for every hero. */
const skillOf = (heroId, slot) => (slot === 'tenacity' ? ctx.skills.tenacity : ctx.skills.heroes[heroId].skills[slot]);
const skillName = (skill) => localizedName(skill.name);
const slotLabel = (slot) => enumLabel('skills.slot', slot);
const skillIcon = (skill, className = 'skills-icon') =>
    `<img class="${className}" src="${ICONS}${escapeHtml(skill.id)}.png" alt="" />`;

export {
    ACTION_ICONS,
    boardHeroes,
    factionHeroes,
    heroClass,
    heroImage,
    heroName,
    skillIcon,
    skillName,
    skillOf,
    slotLabel,
    STAR_ICON,
};

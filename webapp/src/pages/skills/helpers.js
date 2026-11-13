/**
 * Names, icons and small markup pieces shared by the board, the guide and the help.
 */
import { enumLabel, localizedName } from '../../ui/i18n.js';
import { heroImage as heroImageOf, heroName as heroNameOf, skillImage, squadHeroes } from '../../ui/hero-parts.js';
import { ctx } from './state.js';

// The icons of the buttons, as on the buttons themselves and in "How it works".
const ACTION_ICONS = { done: '✓', undo: '↶', startOver: '↺' };

const heroName = (heroId) => heroNameOf(ctx.data.heroes, heroId);
const heroImage = (heroId) => heroImageOf(ctx.data.heroes, heroId);
const heroClass = (heroId) => ctx.data.heroes?.[heroId]?.class;
/** The heroes of the shown faction in the guide's order (the order they are levelled in). */
const factionHeroes = () => ctx.skills.order[ctx.shownFaction] || [];
/** The heroes of the shown faction as the squad stands (the board's order). */
const boardHeroes = () => squadHeroes(ctx.data, factionHeroes(), ctx.shownFaction);
/** A hero's skill in a slot; the 8-star skill is the same for every hero. */
const skillOf = (heroId, slot) => (slot === 'tenacity' ? ctx.skills.tenacity : ctx.skills.heroes[heroId].skills[slot]);
const skillName = (skill) => localizedName(skill.name);
const slotLabel = (slot) => enumLabel('skills.slot', slot);
const skillIcon = (skill, className = 'skills-icon') =>
    `<img class="${className}" src="${skillImage(skill.id)}" alt="" />`;

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
};

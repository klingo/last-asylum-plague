/**
 * The board: the heroes of the faction as the squad stands (tank, tank, carry, support, carry), each with its skills laid out as in the game (auto attack
 * and active on the left, ultimate and passive on the right, the 8-star skill below them), and the details of the
 * selected skill. The skills the next step raises are framed, with the level it takes them to.
 */
import { enumLabel, localizedName, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { formatThousands } from '../../ui/format.js';
import { heroHeadHtml, renderFactionSwitch } from '../../ui/hero-parts.js';
import { START_LEVEL, describeSkill, nextChange, skillCap, skillLevels, starredSkill } from '../../core/skill-path.js';
import { ctx } from './state.js';
import { detailPanel, factionSwitch, heroesPanel } from './elements.js';
import {
    STAR_ICON,
    boardHeroes,
    factionHeroes,
    heroClass,
    skillIcon,
    skillName,
    skillOf,
    slotLabel,
} from './helpers.js';
import { maxAwakening, setAwakening, setFaction } from './progress.js';

/** The level a hero's skill is at on the board (the 8-star skill is Lv 1 and stays so). */
const levelOf = (levels, hero, slot) => (slot === 'tenacity' ? START_LEVEL : levels[hero][slot]);

/** The skill whose details show: the one clicked, else the first the next step raises, else the first hero's ultimate. */
function selection(next) {
    if (ctx.selected) {
        return ctx.selected;
    }
    if (next) {
        return { hero: next.hero, slot: next.slots[0] ?? ctx.steps[ctx.done].skills[0] };
    }
    return { hero: factionHeroes()[0], slot: 'ultimate' };
}

function tileHtml(hero, slot, levels, next, selected) {
    const skill = skillOf(hero, slot);
    const level = levelOf(levels, hero, slot);
    const target = next?.hero === hero && next.slots.includes(slot) ? next.level : null;
    const label = t('skills.tileLabel', { skill: skillName(skill), level });
    const classes = ['skills-tile', target ? 'is-next' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ');
    return `
        <button type="button" class="${classes}" data-hero="${hero}" data-slot="${slot}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" aria-pressed="${selected}">
            <span class="skills-tile__art">
                ${skillIcon(skill, 'skills-tile__icon')}
                <span class="skills-tile__level">${t('skills.level', { level })}</span>
            </span>
            <span class="skills-tile__next">${target ? `→ ${escapeHtml(t('skills.toLevel', { level: target }))}` : ''}</span>
        </button>`;
}

/** An awakenable hero's awakening level and the skill cap it gives. */
function awakeningHtml(hero) {
    const level = ctx.awakening[hero] ?? 0;
    return `
        <div class="skills-awakening">
            <label>
                <span>${tHtml('skills.awakening')}</span>
                <input type="number" min="0" max="${maxAwakening()}" step="1" inputmode="numeric" value="${level}" data-awakening="${hero}" />
            </label>
            <span class="skills-awakening__cap">${tHtml('skills.skillCap', { cap: skillCap(ctx.skills, level) })}</span>
        </div>`;
}

function heroHtml(hero, levels, next, selected) {
    const column = (slots) =>
        slots.map((slot) => tileHtml(hero, slot, levels, next, isSelected(selected, hero, slot))).join('');
    const { left, right } = ctx.skills.layout;
    return `
        <div class="skills-hero">
            ${heroHeadHtml(ctx.data.heroes, hero, heroClass(hero))}
            <div class="skills-grid">
                <div class="skills-col">${column(left)}</div>
                <div class="skills-col">${column(right)}</div>
            </div>
            ${ctx.skills.heroes[hero].awakenable ? awakeningHtml(hero) : ''}
        </div>`;
}

const isSelected = (selected, hero, slot) => selected.hero === hero && selected.slot === slot;

/** A description's parts (`describeSkill`) as markup: the level-dependent numbers in green, "?" where not known. */
function descriptionHtml(parts) {
    return parts
        .map((part) => {
            if (typeof part === 'string') {
                return escapeHtml(part);
            }
            const { sign, now, next, unit } = part;
            const shown = now === null ? '?' : `${sign}${formatThousands(now)}${unit}`;
            const after = next === null ? '' : ` (→ ${sign}${formatThousands(next)}${unit})`;
            return `<span class="skills-value">${shown}${after}</span>`;
        })
        .join('');
}

/** The highest level of a hero's skill: the hero's skill cap (its awakening), the 8-star skill stays at Lv 1. */
const maxLevelOf = (hero, slot) => (slot === 'tenacity' ? START_LEVEL : skillCap(ctx.skills, ctx.awakening[hero] ?? 0));

/**
 * The selected skill: its icon, name with its level and highest level as in the game ("Moon Blade: Lv.22/37", the
 * level in green), the skill's type and the hero's damage type (right-aligned; both light blue for energy,
 * orange for physical), its description at the hero's current level as a 10-star hero has it, and below it the star
 * bonuses with the star each unlocks at.
 */
function detailHtml(levels, next, selected) {
    const { hero, slot } = selected;
    const skill = skillOf(hero, slot);
    const level = levelOf(levels, hero, slot);
    const target = next?.hero === hero && next.slots.includes(slot) ? next.level : level;
    const starred = starredSkill(skill);
    const text = localizedName(starred.description);
    const description = text
        ? descriptionHtml(describeSkill(text, starred.values, level, target))
        : `<span class="text-dim">${tHtml('skills.noDescription')}</span>`;
    const bonuses = starred.bonuses
        .map(
            (bonus) =>
                `<li><span class="skills-bonus__stars">${bonus.stars}</span><img class="skills-bonus__star" src="${STAR_ICON}" alt="" /><span>${escapeHtml(localizedName(bonus.text))}</span></li>`,
        )
        .join('');
    const damageType = ctx.skills.heroes[hero].damage_type;
    const damage = damageType
        ? `<span class="skills-detail__damage">${escapeHtml(enumLabel('skills.damage', damageType))}</span>`
        : '';
    const heading = `${escapeHtml(skillName(skill))}: <span class="skills-value">${tHtml('skills.levelDot', { level })}</span>/${maxLevelOf(hero, slot)}`;
    return `
        ${skillIcon(skill, 'skills-detail__icon')}
        <div class="skills-detail__body">
            <h3>${heading}</h3>
            <div class="skills-detail__meta${damageType ? ` skills-detail__meta--${damageType}` : ''}">
                <span class="skills-detail__type">${escapeHtml(slotLabel(slot))}</span>
                ${damage}
            </div>
            <p>${description}</p>
            ${bonuses ? `<ul class="skills-bonus">${bonuses}</ul>` : ''}
        </div>`;
}

function renderBoard() {
    const levels = skillLevels(ctx.steps, ctx.done);
    const next = nextChange(ctx.steps, ctx.done, levels);
    const selected = selection(next);
    heroesPanel.innerHTML = boardHeroes()
        .map((hero) => heroHtml(hero, levels, next, selected))
        .join('');
    heroesPanel.style.setProperty('--faction-color', `var(--faction-${ctx.shownFaction})`);
    detailPanel.innerHTML = detailHtml(levels, next, selected);
    heroesPanel.querySelectorAll('.skills-tile').forEach((tile) => {
        tile.addEventListener('click', () => {
            ctx.selected = { hero: tile.dataset.hero, slot: tile.dataset.slot };
            renderBoard();
            // Below the heroes: scroll just enough to show it if it is out of view.
            detailPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
    });
    heroesPanel.querySelectorAll('[data-awakening]').forEach((input) => {
        input.addEventListener('change', () => setAwakening(input.dataset.awakening, Number(input.value)));
    });
}

/** Warriors | Rangers | Warlocks, each in its colour. */
function renderFactions() {
    renderFactionSwitch(factionSwitch, { factions: ctx.factions, shown: ctx.shownFaction, onPick: setFaction });
}

export { renderBoard, renderFactions };

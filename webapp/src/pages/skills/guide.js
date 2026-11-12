/**
 * The guide next to the board: the next step with its hero's note and Done / Undo, and the full list of steps.
 */
import { enumLabel, localizedName, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml, progressBarHtml } from '../../ui/html.js';
import { foundationLevel } from '../../core/skill-path.js';
import { ctx } from './state.js';
import { guidePanel } from './elements.js';
import { ACTION_ICONS, heroClass, heroImage, heroName, skillIcon, skillName, skillOf, slotLabel } from './helpers.js';
import { advance, jumpTo, startOver } from './progress.js';

/** A button's label with its icon: "✓ Done". */
const actionLabel = (action) => `<span aria-hidden="true">${ACTION_ICONS[action]}</span> ${tHtml(`skills.${action}`)}`;

/** The levels of the foundation, for its texts: `{ carry, other }`. */
const foundationVars = () => ({
    carry: foundationLevel(ctx.skills, 'carry'),
    other: foundationLevel(ctx.skills, 'tank'),
});

/** What a step raises: "Peerless Blade (Ultimate Skill), Crimson Bloom (Active Skill)". */
function skillsText(step) {
    return step.skills.map((slot) => `${skillName(skillOf(step.hero, slot))} (${slotLabel(slot)})`).join(', ');
}

/** A step in pictures and words: the hero's portrait, the skills' icons and "Marlena · Peerless Blade (Ultimate Skill) → Lv 30". */
function stepHtml(step) {
    const icons = step.skills.map((slot) => skillIcon(skillOf(step.hero, slot), 'skills-step__icon')).join('');
    return `<span class="skills-step"><img class="hero-face" src="${heroImage(step.hero)}" alt="" /><span class="skills-step__icons" aria-hidden="true">${icons}</span><span class="skills-step__text"><strong>${escapeHtml(heroName(step.hero))}</strong> · ${escapeHtml(skillsText(step))} → <strong>${escapeHtml(t('skills.toLevel', { level: step.level }))}</strong></span></span>`;
}

/** Why the step is as it is: the foundation's rule, or the hero's note. */
function noteHtml(step) {
    const text =
        step.phase === 'foundation'
            ? tHtml('skills.foundationHint', foundationVars())
            : escapeHtml(localizedName(ctx.skills.heroes[step.hero].note));
    return `<p class="skills-note">${text}</p>`;
}

function nextCardHtml() {
    const step = ctx.steps[ctx.done];
    const total = ctx.steps.length;
    const body = step
        ? `<p>${stepHtml(step)}</p>${noteHtml(step)}`
        : `<p class="skills-next__done">✓ ${tHtml('skills.allDone')}</p>`;
    return `
        <div class="step-card skills-next">
            <div class="step-card__head">
                <h4>${tHtml('skills.nextStep')}</h4>
                <span class="step-card__count">${tHtml('skills.count', { done: ctx.done, total })}</span>
            </div>
            ${progressBarHtml(ctx.done, total)}
            ${body}
            <div class="step-card__actions">
                <button type="button" class="step-card__done" data-action="done"${step ? '' : ' disabled'}>${actionLabel('done')}</button>
                <button type="button" class="step-card__secondary" data-action="undo"${ctx.done > 0 ? '' : ' disabled'}>${actionLabel('undo')}</button>
            </div>
        </div>`;
}

/** The full list, behind "All steps": the foundation, then each hero's steps under the hero's name. */
function listHtml() {
    let group = null;
    const items = ctx.steps
        .map((step, i) => {
            const key = step.phase === 'foundation' ? 'foundation' : step.hero;
            let heading = '';
            if (key !== group) {
                group = key;
                heading = `<li class="skills-steps__heading">${
                    key === 'foundation'
                        ? tHtml('skills.foundationHeading')
                        : `<img class="hero-face" src="${heroImage(key)}" alt="" />${escapeHtml(heroName(key))} <span class="text-dim">${escapeHtml(enumLabel('gear.class', heroClass(key)))}</span>`
                }</li>`;
            }
            const classes = ['step-list__item', i < ctx.done ? 'is-done' : '', i === ctx.done ? 'is-next' : '']
                .filter(Boolean)
                .join(' ');
            return `${heading}
                <li class="${classes}" data-position="${i + 1}">
                    <button type="button" class="step-list__button">
                        <span class="step-list__number">${i + 1}</span>
                        <span class="step-list__check" aria-hidden="true"></span>
                        <span class="step-list__body"><span class="step-list__text">${stepHtml(step)}</span></span>
                    </button>
                </li>`;
        })
        .join('');
    return `
        <details class="step-list-section" data-list${ctx.listOpen ? ' open' : ''}>
            <summary>${tHtml('skills.showAll', { count: ctx.steps.length })}</summary>
            <p class="step-list-section__hint">${tHtml('skills.catchUp')}</p>
            <ol class="step-list">${items}</ol>
        </details>`;
}

function renderGuide() {
    guidePanel.innerHTML = `
        <div class="step-guide__head">
            <h3>${tHtml('skills.progressTitle')}</h3>
            <button type="button" class="step-guide__reset" data-action="reset"${ctx.done > 0 ? '' : ' disabled'}>${actionLabel('startOver')}</button>
        </div>
        ${nextCardHtml()}
        ${listHtml()}`;
    guidePanel.querySelector('[data-action="done"]').addEventListener('click', () => advance(1));
    guidePanel.querySelector('[data-action="undo"]').addEventListener('click', () => advance(-1));
    guidePanel.querySelector('[data-action="reset"]').addEventListener('click', startOver);
    guidePanel.querySelector('details[data-list]').addEventListener('toggle', (event) => {
        ctx.listOpen = event.target.open;
    });
    guidePanel.querySelectorAll('.step-list__item').forEach((item) => {
        item.querySelector('.step-list__button').addEventListener('click', () => jumpTo(Number(item.dataset.position)));
    });
}

export { actionLabel, foundationVars, renderGuide };

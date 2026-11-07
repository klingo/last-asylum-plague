/**
 * The guide next to the board: the step lists, each queue's next step with what it needs and costs.
 */
import { t, tHtml } from '../../ui/i18n.js';
import { escapeHtml, itemIconSlot } from '../../ui/html.js';
import { formatThousands } from '../../ui/format.js';
import { starIcons, starStep, stepCost, stepItems, stepSlots } from '../../core/gear-path.js';
import { ctx } from './state.js';
import { renderBoard, replaceItemIcons } from './board.js';
import { ACTION_ICONS, ASSETS, LANE_ICONS } from './constants.js';
import { guidePanel } from './elements.js';
import {
    blueprintLink,
    formatStars,
    heroImage,
    heroName,
    heroOf,
    icon,
    itemName,
    laneName,
    openLists,
} from './helpers.js';
import { advance, craftAll, jumpTo, setMrOnHold, startOver } from './progress.js';

/** "Carries", "Tanks", "Whole squad" or the heroes' names. */
function whoText(step) {
    if (step.slots === 'all') {
        return t('gear.wholeSquad');
    }
    const slots = stepSlots(ctx.guide, step);
    const classes = [...new Set(slots.map((slot) => ctx.guide.slots[slot]?.class))];
    if (classes.length === 1 && slots.length > 1) {
        const ofClass = Object.keys(ctx.guide.slots).filter((slot) => ctx.guide.slots[slot].class === classes[0]);
        if (ofClass.every((slot) => slots.includes(slot))) {
            return t(`gear.group.${classes[0]}`);
        }
    }
    return slots.map((slot) => heroName(heroOf(slot))).join(', ');
}

/** The 5 star icons for a star step's target, or for a number of whole stars (5 = MR). */
function starStripHtml(stars, className = 'gear-stars') {
    return `<span class="${className}" aria-hidden="true">${starIcons(starStep(stars))
        .map((name) => `<img src="${ASSETS}gear/stars/${name}.png" alt="" />`)
        .join('')}</span>`;
}

/**
 * A step in pictures and words: the heroes' portraits, the pieces' icons, "Carries · UR Sword → 2 ★" and, for star
 * steps, the target's star strip.
 */
function stepHtml(entry) {
    const faces = stepSlots(ctx.guide, entry.step)
        .map((slot) => `<img class="gear-face" src="${heroImage(heroOf(slot))}" alt="" />`)
        .join('');
    const pieces = stepItems(ctx.gearSet, entry.step)
        .map((item) => itemIconSlot(item))
        .join('');
    const target = entry.kind === 'stars' ? starStripHtml(entry.step.stars) : '';
    return `<span class="gear-step"><span class="gear-step__faces" aria-hidden="true">${faces}</span><span class="gear-step__pieces" aria-hidden="true">${pieces}</span><span class="gear-step__text">${stepText(entry)}</span>${target}</span>`;
}

/** What a step brings its pieces to: "craft", "Lv 40", "2 ★", "5 ★ (MR)". */
function targetText(entry) {
    if (entry.kind === 'craft') {
        return t('gear.craft');
    }
    if (entry.kind === 'level') {
        return t('gear.toLevel', { level: entry.step.level });
    }
    return entry.step.stars === 5 ? t('gear.toMr') : t('gear.toStars', { stars: formatStars(entry.step.stars) });
}

function stepText(entry) {
    const items = entry.step.item ? [entry.step.item] : entry.step.items;
    const itemsText = items === 'all' ? t('gear.allGear') : stepItems(ctx.gearSet, entry.step).map(itemName).join(', ');
    return `<strong>${escapeHtml(whoText(entry.step))}</strong> · ${escapeHtml(itemsText)} → <strong>${escapeHtml(targetText(entry))}</strong>`;
}

/**
 * What a level / star step needs from the other queue first: the dependency in words for the card (`blocked`: "Lv 60
 * needs 4 ★ first (3 ★ only allow up to Lv 56).") and short for the full lists (`gate`: "needs 4 ★ first"), and the
 * step there that brings it (`source`, for the list's ✓; null if none ever does: the guide needs fixing).
 */
function needOf(entry) {
    if (!entry.needs) {
        return null;
    }
    const { path, n, stars, level } = entry.needs;
    const source = n === null ? null : ctx.progress.entriesOf[path][n];
    if (stars) {
        const params = {
            level: entry.step.level,
            stars,
            below: stars - 1,
            cap: ctx.gearSet.level_cap_by_stars?.[stars - 1],
        };
        return {
            source,
            blocked: t(source ? 'gear.blockedByStars' : 'gear.neverStars', params),
            gate: t('gear.gateStars', params),
        };
    }
    const params = { target: targetText(entry), level };
    return {
        source,
        blocked: t(source ? 'gear.blockedByLevel' : 'gear.neverLevel', params),
        gate: t('gear.gateLevel', params),
    };
}

function costHtml(entry) {
    const cost = stepCost(entry.before, entry.step, ctx.guide, ctx.gearSet);
    if (!cost || Object.keys(cost).length === 0) {
        return '';
    }
    const parts = Object.entries(cost)
        .map(([itemId, qty]) => `<span class="gear-cost__part">${itemIconSlot(itemId)}${formatThousands(qty)}</span>`)
        .join('');
    return `<div class="gear-cost">${parts}</div>`;
}

/** The blueprint a star step uses (UR stars, or the MR step to 5 stars). */
function blueprintOf(entry) {
    return entry.step.stars === 5 ? ctx.gearSet.blueprints?.mr : ctx.gearSet.blueprints?.ur;
}

function progressBarHtml(done, total) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    return `<div class="gear-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width: ${percent}%"></span></div>`;
}

/** The full list of a queue, behind "Show all steps"; clicking a step marks everything up to it done. */
function listHtml(path) {
    const entries = ctx.progress.entriesOf[path];
    const steps = entries
        .map((entry, i) => {
            const need = path === 'craft' ? null : needOf(entry);
            let needHtml = '';
            if (need && !need.source) {
                needHtml = `<span class="gear-gate gear-gate--never">${ACTION_ICONS.blocked} ${escapeHtml(need.blocked)}</span>`;
            } else if (need) {
                const met = ctx.progress.isDone(need.source);
                needHtml = `<span class="gear-gate${met ? ' gear-gate--done' : ''}">${met ? '✓' : '○'} ${escapeHtml(need.gate)}</span>`;
            }
            const problem = entry.problems.length
                ? `<span class="gear-path__problem text-bad">${tHtml('gear.problem')}</span>`
                : '';
            return `
                <li class="gear-path__step${ctx.progress.isDone(entry) ? ' is-done' : ''}${entry === ctx.progress.nextOf(path) ? ' is-next' : ''}${ctx.progress.isHeld(entry) ? ' is-held' : ''}" data-path="${path}" data-position="${i + 1}">
                    <button type="button" class="gear-path__button">
                        <span class="gear-path__number">${i + 1}</span>
                        <span class="gear-path__check" aria-hidden="true"></span>
                        <span class="gear-path__body">
                            <span class="gear-path__text">${stepHtml(entry)}</span>
                            ${ctx.progress.isHeld(entry) ? `<span class="gear-path__held">${ACTION_ICONS.hold} ${tHtml('gear.onHold')}</span>` : ''}${needHtml}${costHtml(entry)}${problem}
                        </span>
                    </button>
                </li>`;
        })
        .join('');
    return `
        <details class="gear-list" data-list="${path}"${openLists.has(path) ? ' open' : ''}>
            <summary>${tHtml('gear.showAll', { path: escapeHtml(laneName(path)), count: entries.length })}</summary>
            <ol class="gear-path">${steps}</ol>
        </details>`;
}

/** "No Gear Blueprint (MR) yet": puts the 5 ★ steps on hold (shown while any is still open). */
function holdSwitchHtml() {
    const open = ctx.progress.entriesOf.stars.filter(
        (entry) => ctx.progress.isMrStep(entry) && !ctx.progress.isDone(entry),
    ).length;
    const blueprint = ctx.gearSet.blueprints?.mr;
    if (!open || !blueprint) {
        return '';
    }
    return `
        <label class="gear-hold">
            <input type="checkbox" data-action="hold"${ctx.progress.mrOnHold ? ' checked' : ''} />
            ${itemIconSlot(blueprint)}
            <span>${tHtml('gear.holdMr', { item: escapeHtml(itemName(blueprint)) })}</span>
        </label>`;
}

/** "⛔ Lv 60 needs 4 ★ first (3 ★ only allow up to Lv 56)." */
function blockedHtml(need) {
    return `<div class="gear-next__blocked"><p>${ACTION_ICONS.blocked} ${escapeHtml(need.blocked)}</p></div>`;
}

/** A button's label with its icon: "✓ Done". */
const actionLabel = (action) => `${icon(ACTION_ICONS[action])} ${tHtml(`gear.${action}`)}`;

/**
 * The card of a queue's next step: what to do and what it uses, Done and Undo (+ "All crafted" while crafting), and
 * below the buttons (so they stay put) what it needs first and the stars card's MR switch.
 */
function nextCardHtml(path, titleKey) {
    const entries = ctx.progress.entriesOf[path];
    const next = ctx.progress.nextOf(path);
    const locked = path !== 'craft' && !ctx.progress.craftComplete();
    const held = path === 'stars' ? entries.filter(ctx.progress.isHeld).length : 0;
    let body;
    let blocked = '';
    if (!next) {
        body = held
            ? `<p class="gear-next__held">${ACTION_ICONS.hold} ${tHtml('gear.onlyHeldLeft', { count: held })}</p>`
            : `<p class="gear-next__done">✓ ${tHtml(`gear.allDone.${path}`)}</p>`;
    } else {
        const blueprint = path === 'stars' ? blueprintOf(next) : null;
        const uses = blueprint
            ? `<p class="gear-next__uses">${tHtml('gear.uses')} ${itemIconSlot(blueprint)} ${blueprintLink(blueprint)}</p>`
            : '';
        const need = path === 'craft' || locked || ctx.progress.canAdvance(path) ? null : needOf(next);
        blocked = need ? blockedHtml(need) : '';
        body = `
            <p class="gear-next__step">${stepHtml(next)}</p>
            ${uses}${costHtml(next)}`;
    }
    const craftAllButton =
        path === 'craft' && !ctx.progress.craftComplete()
            ? `<button type="button" class="gear-next__secondary" data-action="craft-all">${actionLabel('craftAll')}</button>`
            : '';
    return `
        <div class="gear-next gear-next--${path}${locked ? ' is-locked' : ''}">
            <div class="gear-next__head">
                <h4>${icon(LANE_ICONS[path])} ${tHtml(titleKey)}</h4>
                <span class="gear-next__count">${tHtml('gear.count', { done: ctx.progress.doneCount(path), total: entries.length })}</span>
            </div>
            ${progressBarHtml(ctx.progress.doneCount(path), entries.length)}
            ${body}
            <div class="gear-next__actions">
                <button type="button" class="gear-next__done-button" data-action="done" data-path="${path}"${ctx.progress.canAdvance(path) ? '' : ' disabled'}>${actionLabel('done')}</button>
                <button type="button" class="gear-next__secondary" data-action="undo" data-path="${path}"${ctx.progress.canUndo(path) ? '' : ' disabled'} title="${escapeHtml(path === 'craft' && ctx.progress.doneCount(path) > 0 && !ctx.progress.canUndo(path) ? t('gear.undoCraftBlocked') : '')}">${actionLabel('undo')}</button>
                ${craftAllButton}
            </div>
            ${blocked}
            ${path === 'stars' ? holdSwitchHtml() : ''}
        </div>`;
}

/** While the 5 ★ steps are on hold: how many wait, for which blueprint. */
function heldNoteHtml() {
    const held = ctx.progress.entriesOf.stars.filter(ctx.progress.isHeld).length;
    const blueprint = ctx.gearSet.blueprints?.mr;
    if (!held || !blueprint) {
        return '';
    }
    return `<p class="gear-held-note">${ACTION_ICONS.hold} ${tHtml('gear.heldNote', { count: held })} ${itemIconSlot(blueprint)} ${blueprintLink(blueprint)}</p>`;
}

function renderGuide() {
    const locked = !ctx.progress.craftComplete();
    guidePanel.innerHTML = `
        <div class="gear-guide__head">
            <h3>${tHtml('gear.progressTitle')}</h3>
            <button type="button" class="gear-guide__reset" data-action="reset"${ctx.progress.doneCount('craft') + ctx.progress.doneCount('level') + ctx.progress.doneCount('stars') === 0 ? ' disabled' : ''}>${actionLabel('startOver')}</button>
        </div>
        <section class="gear-phase${ctx.progress.craftComplete() ? ' is-complete' : ''}">
            <h3 class="gear-phase__title"><span class="gear-phase__number">1</span>${tHtml('gear.phaseCraft')}</h3>
            ${nextCardHtml('craft', 'gear.nextCraft')}
            ${listHtml('craft')}
        </section>
        <section class="gear-phase${locked ? ' is-locked' : ''}">
            <h3 class="gear-phase__title"><span class="gear-phase__number">2</span>${tHtml('gear.phaseUpgrades')}</h3>
            <p class="gear-phase__hint">${locked ? tHtml('gear.locked', { count: ctx.progress.entriesOf.craft.length }) : tHtml('gear.choiceHint')}</p>
            <div class="gear-choices">
                ${nextCardHtml('level', 'gear.nextLevel')}
                ${nextCardHtml('stars', 'gear.nextStar')}
            </div>
            ${heldNoteHtml()}
            ${listHtml('level')}
            ${listHtml('stars')}
        </section>`;
    replaceItemIcons(guidePanel, 'item-icon item-icon--xs');
    guidePanel.querySelectorAll('[data-action="done"]').forEach((button) => {
        button.addEventListener('click', () => advance(button.dataset.path, 1));
    });
    guidePanel.querySelectorAll('[data-action="undo"]').forEach((button) => {
        button.addEventListener('click', () => advance(button.dataset.path, -1));
    });
    guidePanel.querySelector('[data-action="reset"]').addEventListener('click', startOver);
    guidePanel.querySelector('[data-action="craft-all"]')?.addEventListener('click', craftAll);
    guidePanel
        .querySelector('[data-action="hold"]')
        ?.addEventListener('change', (event) => setMrOnHold(event.target.checked));
    guidePanel.querySelectorAll('.gear-list').forEach((list) => {
        list.addEventListener('toggle', () => {
            if (list.open) {
                openLists.add(list.dataset.list);
            } else {
                openLists.delete(list.dataset.list);
            }
        });
    });
    guidePanel.querySelectorAll('.gear-path__step').forEach((li) => {
        li.querySelector('.gear-path__button').addEventListener('click', () =>
            jumpTo(li.dataset.path, Number(li.dataset.position)),
        );
    });
}

function renderProgress() {
    renderBoard();
    renderGuide();
}

export { actionLabel, blockedHtml, needOf, renderProgress, starStripHtml, stepHtml };

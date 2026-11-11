/**
 * The squad board: each slot's hero with a 2×2 gear square, and the faction switch. A gear piece is drawn like in the
 * game: a card in its quality colour with the level on top and the stars along the bottom, inside the picture.
 */
import { enumLabel, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml, hydrateItemIcons, itemIconSlot } from '../../ui/html.js';
import {
    MR_STEP,
    applyStep,
    initialState,
    shownItem,
    starIcons,
    starStep,
    starsOfStep,
    stepItems,
    stepSlots,
} from '../../core/gear-path.js';
import { ctx } from './state.js';
import { ASSETS, PATHS } from './constants.js';
import { board, factionSwitch } from './elements.js';
import { classIcon, factionIcon, formatStars, heroImage, heroName, heroOf, itemName } from './helpers.js';
import { setFaction } from './progress.js';

/** "→ Lv 40", "→ 2 ★", "→ craft": what a queue's next step does to a piece. */
function previewText(entry) {
    if (entry.kind === 'craft') {
        return t('gear.previewCraft');
    }
    if (entry.kind === 'level') {
        return `→ ${t('gear.toLevel', { level: entry.step.level })}`;
    }
    return `→ ${entry.step.stars === 5 ? t('gear.toMr') : t('gear.toStars', { stars: formatStars(entry.step.stars) })}`;
}

/**
 * The squad with every done step (in the merged order, which keeps their dependencies), and what's up next:
 * "slot:item" -> [{ path, text }] for the pieces the next possible step of each queue will change (shown on the
 * board before Done is clicked).
 */
function shownState() {
    let state = initialState(ctx.guide, ctx.gearSet);
    for (const entry of ctx.progress.merged) {
        if (ctx.progress.isDone(entry)) {
            state = applyStep(state, entry.step, ctx.guide, ctx.gearSet);
        }
    }
    const upcoming = new Map();
    for (const path of PATHS) {
        const next = ctx.progress.nextOf(path);
        if (!next || !ctx.progress.canDo(next)) {
            continue;
        }
        for (const slot of stepSlots(ctx.guide, next.step)) {
            for (const item of stepItems(ctx.gearSet, next.step)) {
                const piece = state[slot]?.[item];
                const changes =
                    next.kind === 'craft'
                        ? !piece?.crafted
                        : next.kind === 'level'
                          ? piece?.level < next.step.level
                          : piece?.starStep < starStep(next.step.stars);
                if (changes) {
                    const key = `${slot}:${item}`;
                    upcoming.set(key, [...(upcoming.get(key) || []), { path, text: previewText(next) }]);
                }
            }
        }
    }
    return { state, upcoming };
}

// The silhouette file of a piece (assets/gear/slots/): its item id without the quality, `ur_sword` -> `sword`.
const slotImage = (item) => escapeHtml(item.replace(/^ur_/, ''));

function tileHtml(state, upcoming, slot, item) {
    const piece = state[slot][item];
    const shown = shownItem(ctx.gearSet, item, piece.starStep); // at MR: the MR item (its picture and name)
    const next = upcoming.get(`${slot}:${item}`) || [];
    const classes = [
        'gear-tile',
        piece.crafted ? '' : 'gear-tile--empty',
        ...next.map(({ path }) => `gear-tile--next-${path}`),
        piece.starStep === MR_STEP ? 'gear-tile--mr' : '',
    ].filter(Boolean);
    const label = piece.crafted
        ? t('gear.tileLabel', {
              item: itemName(shown),
              level: piece.level,
              stars: formatStars(starsOfStep(piece.starStep)),
          })
        : t('gear.tileNotCrafted', { item: itemName(item) });
    const starsHtml = starIcons(piece.starStep)
        .map((name) => `<img src="${ASSETS}gear/stars/${name}.png" alt="" />`)
        .join('');
    // Not crafted: the game's empty slot, a grey card with the piece's silhouette (assets/gear/slots/); the piece
    // that is next to craft shows the item itself, dimmed.
    const crafting = next.some(({ path }) => path === 'craft');
    const art = piece.crafted
        ? `${itemIconSlot(shown)}
                <span class="gear-tile__level">${t('gear.level', { level: piece.level })}</span>
                <span class="gear-tile__stars">${starsHtml}</span>`
        : crafting
          ? itemIconSlot(item)
          : `<img class="gear-tile__slot" src="${ASSETS}gear/slots/${slotImage(item)}.png" alt="" />`;
    return `
        <div class="${classes.join(' ')}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" role="img">
            <span class="gear-tile__art">
                ${art}
            </span>
            <span class="gear-tile__next">${next.map(({ path, text }) => `<span class="gear-tile__next--${path}">${escapeHtml(text)}</span>`).join(' ')}</span>
        </div>`;
}

function slotHtml(state, upcoming, slot) {
    const { class: heroClass } = ctx.guide.slots[slot];
    const hero = heroOf(slot);
    const name = heroName(hero);
    const square = ctx.gearSet.layout
        .flat()
        .map((item) => tileHtml(state, upcoming, slot, item))
        .join('');
    return `
        <div class="gear-slot">
            <figure class="gear-hero">
                <img src="${heroImage(hero)}" alt="${escapeHtml(name)}" />
                <figcaption>
                    <strong>${escapeHtml(name)}</strong>
                    <span class="gear-class gear-class--${heroClass}">${classIcon(heroClass)}${escapeHtml(enumLabel('gear.class', heroClass))}</span>
                </figcaption>
            </figure>
            <div class="gear-square">${square}</div>
        </div>`;
}

function renderBoard() {
    const { state, upcoming } = shownState();
    const row = (slots, labelKey) => `
        <div class="gear-row">
            <div class="gear-row__label">${tHtml(labelKey)}</div>
            <div class="gear-row__slots">${slots.map((slot) => slotHtml(state, upcoming, slot)).join('')}</div>
        </div>`;
    board.innerHTML = row(ctx.guide.formation.front, 'gear.frontRow') + row(ctx.guide.formation.back, 'gear.backRow');
    board.style.setProperty('--faction-color', `var(--faction-${ctx.shownFaction})`);
    replaceItemIcons(board, 'item-icon');
}

/** Warriors | Rangers | Warlocks, each in its colour (only with more than one faction). */
function renderFactions() {
    factionSwitch.hidden = ctx.factions.length < 2;
    factionSwitch.setAttribute('aria-label', t('gear.factions'));
    factionSwitch.innerHTML = ctx.factions
        .map(
            (faction) => `
            <button type="button" class="gear-faction${faction === ctx.shownFaction ? ' is-active' : ''}" data-faction="${faction}" style="--faction-color: var(--faction-${faction})" aria-pressed="${faction === ctx.shownFaction}">
                ${factionIcon(faction)} ${escapeHtml(enumLabel('gear.faction', faction))}
            </button>`,
        )
        .join('');
    factionSwitch.querySelectorAll('[data-faction]').forEach((button) => {
        button.addEventListener('click', () => setFaction(button.dataset.faction));
    });
}

function replaceItemIcons(root, className) {
    hydrateItemIcons(root, className, itemName);
}

export { renderBoard, renderFactions, replaceItemIcons, tileHtml };

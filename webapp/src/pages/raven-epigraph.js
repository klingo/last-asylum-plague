/**
 * Raven Epigraph: the Raven's UR epigraphs and how many chests it takes to max them all (core/epigraph-plan.js). The
 * three plans (Warriors, Rangers, Warlocks) stand side by side, each laid out as the game's Epigraph Plan: the four
 * epigraphs (Frenzied Flock on top, Guard of Nature in the middle, Protective Charm and Reversal Power below) on the triangle
 * picture, each in the socket's frame with a border by its rarity, its slot's badge and its promotion level as diamonds
 * along the bottom edge (the red gem at the highest). A click on an epigraph opens its promote panel: the epigraph
 * before and after the next promotion, the progress bar of the six levels (a click sets the level) and the copies on hand
 * against what the next promotion takes. Under the boards are the UR Epigraph Choice Chests and UR Epigraph Shards on hand
 * and the answer: how many UR or SSR Epigraph Chests it takes to fill what the 12 epigraphs still need.
 * The pictures are in assets/raven/epigraphs: `<faction>/<epigraph>_iv.png`, `badges/`, `board/` (frame, triangle), `rarity/`, `gems/`.
 * Saved in this browser (and synced) as `{ epigraphs: { <item id>: { level, copies } }, choiceChests, shards }`,
 * as soon as something changes. A change draws only what it touches, so a number being typed keeps its place.
 */
import { startPage } from '../ui/page.js';
import '../styles/pages/raven-epigraph.css';
import { STORAGE_KEYS, readJson, writeJson } from '../ui/storage.js';
import { enumLabel, localizedName, t, tHtml } from '../ui/i18n.js';
import { escapeAttr, escapeHtml, hydrateItemIcons, itemIconSlot, statHtml } from '../ui/html.js';
import { formatPercent, formatThousands } from '../ui/format.js';
import { BASE_URL } from '../ui/base-url.js';
import { factionIcon } from '../ui/hero-parts.js';
import { clampLevel } from '../core/hero-stars.js';
import {
    CHESTS,
    CHOICE_CHEST,
    EPIGRAPHS,
    EPIGRAPH_FACTIONS,
    MAX_COUNT,
    MAX_LEVEL,
    PROMOTE_COPIES,
    SHARD,
    chestDrops,
    chestEstimate,
    clampCount,
    copiesNeeded,
    epigraphItemId,
    epigraphLevel,
    nextPromotion,
    stockOf,
} from '../core/epigraph-plan.js';

const plan = document.getElementById('epigraph-plan');
const stock = document.getElementById('epigraph-stock');
const stats = document.getElementById('epigraph-stats');
const dialog = document.getElementById('epigraph-dialog');
const help = document.getElementById('epigraph-help');

// The place of each of EPIGRAPHS on the board (a CSS modifier).
const SLOTS = ['top', 'left', 'right', 'center'];
// The diamonds along an epigraph's bottom edge: one for each level but the highest, which is the red gem.
const GEM_COUNT = MAX_LEVEL - 1;
const PICTURES = `${BASE_URL}assets/raven/epigraphs/`;
const gemImage = (name) => `${PICTURES}gems/${name}.png`;

let data = null;
let drops = null;
// What is saved (see the header).
let saved = {};
// The epigraph (of `EPIGRAPHS`) of a plan (`EPIGRAPH_FACTIONS`) whose promote panel is open: `{ epigraph, faction }`.
let opened = null;

const itemName = (itemId) => localizedName(data.items[itemId]?.name) || itemId;

function save(change) {
    saved = { ...saved, ...change };
    writeJson(STORAGE_KEYS.epigraphs, saved);
}

/** Sets an epigraph's `level` and / or `copies`. */
function setEpigraph(itemId, change) {
    const next = { ...epigraphLevel(saved, itemId), ...change };
    const entry = { level: clampLevel(next.level, MAX_LEVEL), copies: clampCount(next.copies) };
    save({ epigraphs: { ...saved.epigraphs, [itemId]: entry } });
}

/** The diamonds along the bottom edge for a level: filled up to it, empty above; the red gem at the highest level. */
function gemsHtml(level) {
    if (level >= MAX_LEVEL) {
        return `<span class="epigraph-gems"><img class="epigraph-gem epigraph-gem--max" src="${gemImage('max')}" alt="" /></span>`;
    }
    const gems = Array.from(
        { length: GEM_COUNT },
        (_, i) => `<img class="epigraph-gem" src="${gemImage(i < level ? 'on' : 'off')}" alt="" />`,
    );
    return `<span class="epigraph-gems">${gems.join('')}</span>`;
}

/**
 * An epigraph's picture at `level`: its art with the border of its rarity over it, set in the socket's frame, the slot's
 * badge in the corner and the diamonds.
 */
function artHtml(epigraph, faction, level) {
    const rarity = data.items[epigraphItemId(epigraph, faction)]?.rarity;
    return `<span class="epigraph-art"><img class="epigraph-art__frame" src="${PICTURES}board/frame.png" alt="" /><img class="epigraph-art__img" src="${PICTURES}${faction}/${epigraph}_iv.png" alt="" /><img class="epigraph-art__rarity" src="${PICTURES}rarity/${rarity}.png" alt="" /><img class="epigraph-art__badge" src="${PICTURES}badges/${epigraph}.png" alt="" />${gemsHtml(level)}</span>`;
}

/** The picture of an epigraph on the board: a button that opens its promote panel, with the copies it still needs. */
function tileHtml(epigraph, faction) {
    const itemId = epigraphItemId(epigraph, faction);
    const { level, copies } = epigraphLevel(saved, itemId);
    const need = copiesNeeded(level, copies);
    const name = escapeHtml(itemName(itemId));
    const label = escapeAttr(t('ravenEpigraph.tileLabel', { name, level, max: MAX_LEVEL }));
    const count = formatThousands(need);
    const needHtml = need
        ? `<span class="epigraph-tile__need" title="${escapeAttr(t('ravenEpigraph.tileNeed', { count }))}">${count}</span>`
        : '';
    return `<button type="button" class="epigraph-tile epigraph-tile--${SLOTS[EPIGRAPHS.indexOf(epigraph)]}" data-epigraph="${epigraph}" data-faction="${faction}" title="${name}" aria-label="${label}">${artHtml(epigraph, faction, level)}${needHtml}</button>`;
}

/** The board of a plan under its faction, and the copies it still needs under the board. */
function planHtml(faction) {
    const missing = EPIGRAPHS.reduce((sum, epigraph) => {
        const { level, copies } = epigraphLevel(saved, epigraphItemId(epigraph, faction));
        return sum + copiesNeeded(level, copies);
    }, 0);
    return `
        <div class="epigraph-plan">
            <h3 class="epigraph-plan__faction" style="--faction-color: var(--faction-${faction})">${factionIcon(faction)} ${escapeHtml(enumLabel('gear.faction', faction))}</h3>
            <div class="epigraph-board">
                <img class="epigraph-board__triangle" src="${PICTURES}board/triangle.png" alt="" />
                ${EPIGRAPHS.map((epigraph) => tileHtml(epigraph, faction)).join('')}
            </div>
            <p class="epigraph-plan__missing">${missing ? tHtml('ravenEpigraph.planMissing', { count: formatThousands(missing) }) : tHtml('ravenEpigraph.planDone')}</p>
        </div>`;
}

function renderPlan() {
    plan.innerHTML = EPIGRAPH_FACTIONS.map(planHtml).join('');
    plan.querySelectorAll('[data-epigraph]').forEach((tile) => {
        tile.addEventListener('click', () => openDialog(tile.dataset.epigraph, tile.dataset.faction));
    });
}

/** What the open epigraph still needs: the copies, or that it is done. */
function neededHtml(level, copies) {
    const need = copiesNeeded(level, copies);
    return need
        ? tHtml('ravenEpigraph.promote.needed', { count: formatThousands(need), max: MAX_LEVEL })
        : tHtml('ravenEpigraph.promote.done');
}

/** The progress bar of the levels: a diamond for each, filled up to the level; a click sets that level. */
function barHtml(level) {
    const marks = PROMOTE_COPIES.map((_, i) => {
        const target = i + 1;
        const label = escapeAttr(t('ravenEpigraph.promote.setLevel', { level: target }));
        return `<button type="button" class="epigraph-bar__mark" data-level="${target}" aria-pressed="${target <= level}" title="${label}" aria-label="${label}"><img src="${gemImage(target <= level ? 'on' : 'off')}" alt="" /></button>`;
    });
    const fill = level > 1 ? (level - 1) / (MAX_LEVEL - 1) : 0;
    return `<div class="epigraph-bar" style="--fill: ${fill}">${marks.join('')}</div>`;
}

/** The copies on hand against what the next promotion takes (red while short), or that the epigraph is at its highest. */
function copiesHtml(level, copies) {
    const next = nextPromotion(level);
    if (next === null) {
        return `<div class="epigraph-dialog__copies">${tHtml('ravenEpigraph.promote.maxed')}</div>`;
    }
    return `
        <label class="epigraph-dialog__copies">
            <span>${tHtml('ravenEpigraph.promote.copies')}</span>
            <input type="number" class="epigraph-dialog__input${copies < next ? ' text-bad' : ''}" min="0" max="${MAX_COUNT}" step="1" value="${copies}" data-copies />
            <span>/ ${next}</span>
        </label>`;
}

function dialogHtml(epigraph, faction) {
    const itemId = epigraphItemId(epigraph, faction);
    const { level, copies } = epigraphLevel(saved, itemId);
    const after =
        level < MAX_LEVEL
            ? `<span class="epigraph-arrow" aria-hidden="true">→</span>${artHtml(epigraph, faction, level + 1)}`
            : '';
    const stepLabel = (key) => escapeAttr(t(`ravenEpigraph.promote.${key}`));
    return `
        <div class="epigraph-dialog__window">
            <div class="epigraph-dialog__head">
                <h3 id="epigraph-dialog-title">${tHtml('ravenEpigraph.promote.title')}</h3>
                <button type="button" class="btn-secondary epigraph-dialog__close" data-close data-key="close" aria-label="${stepLabel('close')}">✕</button>
            </div>
            <div class="epigraph-dialog__tiles">${artHtml(epigraph, faction, level)}${after}</div>
            <div class="epigraph-dialog__name">${escapeHtml(itemName(itemId))}</div>
            <div class="epigraph-dialog__progress">
                <strong>${tHtml('ravenEpigraph.promote.progress', { level, max: MAX_LEVEL })}</strong>
                <span class="epigraph-dialog__steps">
                    <button type="button" class="btn-secondary" data-step="-1" data-key="lower" title="${stepLabel('lower')}" aria-label="${stepLabel('lower')}"${level <= 0 ? ' disabled' : ''}>−</button>
                    <button type="button" class="btn-secondary" data-step="1" data-key="raise" title="${stepLabel('raise')}" aria-label="${stepLabel('raise')}"${level >= MAX_LEVEL ? ' disabled' : ''}>+</button>
                </span>
            </div>
            ${barHtml(level)}
            ${copiesHtml(level, copies)}
            <div class="epigraph-dialog__needed text-dim" data-needed>${neededHtml(level, copies)}</div>
        </div>`;
}

function renderDialog() {
    if (!opened) {
        return;
    }
    const { epigraph, faction } = opened;
    const itemId = epigraphItemId(epigraph, faction);
    // A button the panel is drawn again under (the − / +) keeps the focus.
    const key = dialog.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    dialog.innerHTML = dialogHtml(epigraph, faction);
    if (key) {
        dialog.querySelector(`[data-key="${key}"]`)?.focus();
    }
    const setLevel = (level) => {
        setEpigraph(itemId, { level });
        renderPlan();
        renderStats();
        renderDialog();
    };
    const current = epigraphLevel(saved, itemId).level;
    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    // A click on the level the bar is at takes it back one step: the first level is the only way to reach 0 on the bar.
    dialog.querySelectorAll('[data-level]').forEach((mark) => {
        const target = Number(mark.dataset.level);
        mark.addEventListener('click', () => setLevel(target === current ? target - 1 : target));
    });
    dialog.querySelectorAll('[data-step]').forEach((button) => {
        button.addEventListener('click', () => setLevel(current + Number(button.dataset.step)));
    });
    dialog.querySelector('[data-copies]')?.addEventListener('change', (event) => {
        const input = event.target;
        setEpigraph(itemId, { copies: Number(input.value) });
        const { level, copies } = epigraphLevel(saved, itemId);
        input.value = copies;
        input.classList.toggle('text-bad', copies < nextPromotion(level));
        dialog.querySelector('[data-needed]').innerHTML = neededHtml(level, copies);
        renderPlan();
        renderStats();
    });
}

function openDialog(epigraph, faction) {
    opened = { epigraph, faction };
    renderDialog();
    if (!dialog.open) {
        dialog.showModal();
    }
}

/** The UR Epigraph Choice Chests and UR Epigraph Shards on hand. */
function renderStock() {
    const fields = [
        [CHOICE_CHEST, 'choiceChests'],
        [SHARD, 'shards'],
    ].map(
        ([itemId, field]) =>
            `<label class="epigraph-stock__field">${itemIconSlot(itemId)}<span>${escapeHtml(itemName(itemId))}</span><input type="number" min="0" max="${MAX_COUNT}" step="1" value="${stockOf(saved, field)}" data-stock="${field}" /></label>`,
    );
    stock.innerHTML = `<h3>${tHtml('ravenEpigraph.stockTitle')}</h3><div class="epigraph-stock__fields">${fields.join('')}</div>`;
    hydrateItemIcons(stock, 'item-icon', itemName);
    stock.querySelectorAll('[data-stock]').forEach((input) => {
        input.addEventListener('change', () => {
            const value = clampCount(Number(input.value));
            input.value = value;
            save({ [input.dataset.stock]: value });
            renderStats();
        });
    });
}

/** The answer: the copies still needed, how many of them the stock fills, and the chests it takes of each kind. */
function renderStats() {
    const result = chestEstimate(data, saved);
    const number = (value) => (value === undefined ? t('common.dash') : formatThousands(value));
    const rows = Object.entries(CHESTS).map(([kind, itemId]) => {
        const estimate = result[kind];
        return `<tr>
            <td><span class="item-cell">${itemIconSlot(itemId)}${escapeHtml(itemName(itemId))}</span></td>
            <td class="text-right table-col-fit">${number(estimate?.expected)}</td>
            <td class="text-right table-col-fit">${number(estimate?.safe)}</td>
        </tr>`;
    });
    const nothing = result.missing === result.covered;
    const body = nothing
        ? `<p class="epigraph-note">${tHtml(result.missing === 0 ? 'ravenEpigraph.allMaxed' : 'ravenEpigraph.stockCovers')}</p>`
        : `<div class="table-wrap"><table>
                <thead><tr>
                    <th>${tHtml('ravenEpigraph.chests')}</th>
                    <th class="text-right table-col-fit table-col-num">${tHtml('ravenEpigraph.expected')}</th>
                    <th class="text-right table-col-fit table-col-num">${tHtml('ravenEpigraph.safe')}</th>
                </tr></thead>
                <tbody>${rows.join('')}</tbody>
            </table></div>
            <p class="epigraph-note text-dim">${tHtml('ravenEpigraph.resultNote')}</p>`;
    stats.innerHTML = `
        <h3>${tHtml('ravenEpigraph.resultTitle')}</h3>
        <div class="mine-stats">
            ${statHtml(tHtml('ravenEpigraph.missing'), formatThousands(result.missing))}
            ${statHtml(tHtml('ravenEpigraph.covered'), formatThousands(result.covered))}
        </div>
        ${body}`;
    hydrateItemIcons(stats, 'item-icon', itemName);
}

function renderHelp() {
    const section = (titleKey, textKey, vars) =>
        `<section><h3>${tHtml(titleKey)}</h3><p>${tHtml(textKey, vars)}</p></section>`;
    const { chests, choiceShards, craftShards } = drops;
    help.innerHTML = [
        section('ravenEpigraph.help.aboutTitle', 'ravenEpigraph.help.aboutText'),
        section('ravenEpigraph.help.promoteTitle', 'ravenEpigraph.help.promoteText', {
            steps: PROMOTE_COPIES.join(', '),
            total: PROMOTE_COPIES.reduce((sum, step) => sum + step, 0),
        }),
        section('ravenEpigraph.help.chestsTitle', 'ravenEpigraph.help.chestsText', {
            urShards: formatThousands(chests.ur.shards),
            ssrChance: formatPercent(chests.ssr.urChance, 0),
            ssrShards: formatThousands(chests.ssr.shards),
            craftShards: formatThousands(craftShards),
            choiceShards: formatThousands(choiceShards),
        }),
        section('ravenEpigraph.help.answerTitle', 'ravenEpigraph.help.answerText'),
        section('ravenEpigraph.help.savedTitle', 'ravenEpigraph.help.savedText'),
    ].join('');
}

function render() {
    renderHelp();
    renderPlan();
    renderStock();
    renderStats();
    renderDialog();
}

function init(loaded) {
    data = loaded;
    drops = chestDrops(data);
    saved = readJson(STORAGE_KEYS.epigraphs);
    // A click on the backdrop (the dialog element itself, its window fills the rest) closes the panel.
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
            dialog.close();
        }
    });
    // The focus goes back to the epigraph's tile (the board was drawn again meanwhile).
    dialog.addEventListener('close', () => {
        plan.querySelector(`[data-epigraph="${opened.epigraph}"][data-faction="${opened.faction}"]`)?.focus();
        opened = null;
    });
    render();
}

startPage('raven-epigraph', { init, onLocaleChange: () => render() });

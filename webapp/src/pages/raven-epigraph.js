/**
 * Raven Epigraph: the Raven's UR epigraphs and how many chests it takes to max them all (core/epigraph-plan.js). The
 * three plans (Warriors, Rangers, Warlocks) stand side by side, each laid out as the game's Epigraph Plan: the four
 * epigraphs (Frenzied Flock on top, Guard of Nature in the middle, Protective Charm and Reversal Power below) on the triangle
 * picture, each in the socket's frame with a border by its rarity, its slot's badge and its promotion level as diamonds
 * along the bottom edge (the red gem at the highest). A click on an epigraph selects it (ringed, a second click lets go)
 * and opens its card under the board of its own plan (so on a phone right below the tapped one), as the Skill Upgrade Path
 * does with a skill: the epigraph's text with its numbers at the level it is at (core/epigraph-effect.js; the part after a
 * plus is the bonus of the Raven Evolve level entered above the plans), its level as a row of buttons, the copies on hand against what the next promotion takes, and Promote,
 * which spends those copies and raises the level by one. Under the plans are the UR Epigraph Choice Chests and UR Epigraph
 * Shards on hand
 * and the answer: how many UR, SSR or SR Epigraph Chests it takes to fill what the 12 epigraphs still need.
 * The pictures are in assets/raven/epigraphs: `<faction>/<epigraph>_iv.png`, `badges/`, `board/` (frame, triangle), `rarity/`, `gems/`.
 * Saved in this browser (and synced) as `{ epigraphs: { <item id>: { level, copies } }, choiceChests, shards }`,
 * as soon as something changes. A change draws only what it touches, so a number being typed keeps its place.
 */
import { startPage } from '../ui/page.js';
import '../styles/pages/raven-epigraph.css';
import { STORAGE_KEYS, readJson, writeJson } from '../ui/storage.js';
import { enumLabel, localizedName, t, tHtml } from '../ui/i18n.js';
import {
    escapeAttr,
    escapeHtml,
    hydrateItemIcons,
    itemIconSlot,
    progressBarHtml,
    segmentedHtml,
    statHtml,
} from '../ui/html.js';
import { formatCompact, formatPercent, formatThousands } from '../ui/format.js';
import { BASE_URL } from '../ui/base-url.js';
import { factionHtml, factionIcon, lockImage } from '../ui/hero-parts.js';
import ravenData from '../../../data/raven_epigraphs.json';
import { clampLevel } from '../core/hero-stars.js';
import {
    clampEvolve,
    describeEpigraph,
    effectEntry,
    evolveBoost,
    evolveLevelOf,
    planUnlocked,
} from '../core/epigraph-effect.js';
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

const evolve = document.getElementById('epigraph-evolve');
const plan = document.getElementById('epigraph-plan');
const stock = document.getElementById('epigraph-stock');
const stats = document.getElementById('epigraph-stats');
const help = document.getElementById('epigraph-help');

// The place of each of EPIGRAPHS on the board (a CSS modifier).
const SLOTS = ['top', 'left', 'right', 'center'];
// The diamonds along an epigraph's bottom edge: one for each level but the highest, which is the red gem.
const GEM_COUNT = MAX_LEVEL - 1;
const PICTURES = `${BASE_URL}assets/raven/epigraphs/`;
const gemImage = (name) => `${PICTURES}gems/${name}.png`;
// How long a card takes to open (the slot's transition in the CSS), after which it is scrolled into view.
const OPEN_MS = 220;

let data = null;
let drops = null;
// What is saved (see the header).
let saved = {};
// The epigraph (of `EPIGRAPHS`) of a plan (`EPIGRAPH_FACTIONS`) shown on a card: `{ epigraph, faction }`, or null.
let selected = null;
// The card of the selected epigraph, in the slot under its plan's board.
let card = null;

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

/** The plans the Raven Evolve level has unlocked; the others are greyed out and don't count. */
const unlockedPlans = () =>
    EPIGRAPH_FACTIONS.filter((faction) => planUnlocked(ravenData, faction, evolveLevelOf(ravenData, saved)));

const isSelected = (epigraph, faction) => selected?.epigraph === epigraph && selected?.faction === faction;

/** The picture of an epigraph on the board: a button that selects it, with the copies it still needs. */
function tileHtml(epigraph, faction, open) {
    const itemId = epigraphItemId(epigraph, faction);
    const { level, copies } = epigraphLevel(saved, itemId);
    const need = copiesNeeded(level, copies);
    const name = escapeHtml(itemName(itemId));
    const label = escapeAttr(t('ravenEpigraph.tileLabel', { name, level, max: MAX_LEVEL }));
    const count = formatThousands(need);
    const needHtml = need
        ? `<span class="epigraph-tile__need" title="${escapeAttr(t('ravenEpigraph.tileNeed', { count }))}">${count}</span>`
        : '';
    return `<button type="button" class="epigraph-tile epigraph-tile--${SLOTS[EPIGRAPHS.indexOf(epigraph)]}${isSelected(epigraph, faction) ? ' is-selected' : ''}" data-epigraph="${epigraph}" data-faction="${faction}" title="${name}" aria-label="${label}" aria-pressed="${isSelected(epigraph, faction)}"${open ? '' : ' disabled'}>${artHtml(epigraph, faction, level)}${needHtml}</button>`;
}

/**
 * The frames of the three plans, drawn once (and again on a language switch): a faction heading, the place of its board and
 * the slot its card opens in. The boards and the cards are drawn into them, so a change on a board leaves a card alone.
 */
function renderFrames() {
    plan.innerHTML = EPIGRAPH_FACTIONS.map(
        (faction) => `
        <div class="epigraph-plan">
            <h3 class="epigraph-plan__faction" style="--faction-color: var(--faction-${faction})">${factionIcon(faction)} ${escapeHtml(enumLabel('gear.faction', faction))}</h3>
            <div data-board="${faction}"></div>
            <div class="epigraph-slot" data-slot="${faction}"><div class="epigraph-slot__clip"><div class="epigraph-detail"></div></div></div>
        </div>`,
    ).join('');
}

/** The board of a plan, and the copies it still needs under it. */
function boardHtml(faction) {
    const open = unlockedPlans().includes(faction);
    const missing = EPIGRAPHS.reduce((sum, epigraph) => {
        const { level, copies } = epigraphLevel(saved, epigraphItemId(epigraph, faction));
        return sum + copiesNeeded(level, copies);
    }, 0);
    // A plan that isn't unlocked is greyed out with a padlock, and says at which Raven Evolve level it is.
    const line = !open
        ? tHtml('ravenEpigraph.planLocked', { level: ravenData.plan_unlock_levels[faction] })
        : missing
          ? tHtml('ravenEpigraph.planMissing', { count: formatThousands(missing) })
          : tHtml('ravenEpigraph.planDone');
    return `
        <div class="epigraph-board${open ? '' : ' is-locked'}">
            <img class="epigraph-board__triangle" src="${PICTURES}board/triangle.png" alt="" />
            ${EPIGRAPHS.map((epigraph) => tileHtml(epigraph, faction, open)).join('')}
            ${open ? '' : `<img class="epigraph-board__lock" src="${lockImage}" alt="" />`}
        </div>
        <p class="epigraph-plan__missing">${line}</p>`;
}

/** Draws the boards (not the cards). */
function renderPlan() {
    // The tile that has the focus keeps it when the boards are drawn again.
    const focused = plan.contains(document.activeElement) ? document.activeElement.dataset : null;
    for (const faction of EPIGRAPH_FACTIONS) {
        plan.querySelector(`[data-board="${faction}"]`).innerHTML = boardHtml(faction);
    }
    if (focused?.epigraph) {
        plan.querySelector(`[data-epigraph="${focused.epigraph}"][data-faction="${focused.faction}"]`)?.focus();
    }
    plan.querySelectorAll('[data-epigraph]').forEach((tile) => {
        tile.addEventListener('click', () => select(tile.dataset.epigraph, tile.dataset.faction));
    });
}

/** Selects an epigraph for a card; the selected one again lets go of it. */
function select(epigraph, faction) {
    selected = isSelected(epigraph, faction) ? null : { epigraph, faction };
    renderPlan();
    renderDetail({ scroll: true });
}

/** What the selected epigraph still needs: the copies, or that it is done. */
function neededHtml(level, copies) {
    const need = copiesNeeded(level, copies);
    return need
        ? tHtml('ravenEpigraph.detail.needed', { count: formatThousands(need), max: MAX_LEVEL })
        : tHtml('ravenEpigraph.detail.done');
}

/** The card's controls, drawn once for a selected epigraph; `showDetail` fills in what changes. */
function detailHtml(epigraph, faction) {
    const name = escapeHtml(itemName(epigraphItemId(epigraph, faction)));
    const levels = Array.from({ length: MAX_LEVEL + 1 }, (_, level) => ({
        value: String(level),
        label: String(level),
    }));
    return `
        <div class="epigraph-detail__top">
            <div class="epigraph-detail__art" data-art></div>
            <h3>${name}</h3>
        </div>
        <p class="epigraph-detail__text" data-text></p>
        <div class="epigraph-detail__row">
            <span class="epigraph-detail__label">${tHtml('ravenEpigraph.detail.level')}</span>
            ${segmentedHtml({ name: `epigraph-level-${faction}`, ariaLabel: t('ravenEpigraph.detail.levelGroup', { name }), options: levels, current: '', attrs: 'data-level-radio' })}
        </div>
        <label class="epigraph-detail__row" data-copies-row>
            <span class="epigraph-detail__label">${tHtml('ravenEpigraph.detail.copies')}</span>
            <input type="number" min="0" max="${MAX_COUNT}" step="1" data-copies />
            <span data-copies-next></span>
        </label>
        <div data-progress></div>
        <div class="epigraph-detail__foot">
            <span class="text-dim" data-needed></span>
            <button type="button" data-promote></button>
        </div>`;
}

/**
 * Brings the card up to date with what is saved: the picture, the text, the level buttons, the copies against the next
 * promotion with their bar, what is still needed, and Promote (the last three only below the highest level). The controls are not drawn again, so a number being typed keeps its place.
 */
function showDetail() {
    const { epigraph, faction } = selected;
    const { level, copies } = epigraphLevel(saved, epigraphItemId(epigraph, faction));
    const next = nextPromotion(level);
    card.querySelector('[data-art]').innerHTML = artHtml(epigraph, faction, level);
    const entry = effectEntry(ravenData, epigraph, faction);
    const text = entry ? localizedName(entry.description) : '';
    const effect = card.querySelector('[data-text]');
    effect.hidden = !text;
    effect.innerHTML = text
        ? effectHtml(describeEpigraph(entry, text, level, evolveBoost(ravenData, evolveLevelOf(ravenData, saved))))
        : '';
    card.querySelectorAll('[data-level-radio]').forEach((radio) => {
        radio.checked = Number(radio.value) === level;
    });
    // At the highest level there is nothing to count towards: no copies row, no bar, no Promote.
    card.querySelector('[data-copies-row]').hidden = next === null;
    if (next !== null) {
        const input = card.querySelector('[data-copies]');
        if (document.activeElement !== input) {
            input.value = copies;
        }
        input.classList.toggle('text-bad', copies < next);
        card.querySelector('[data-copies-next]').textContent = `/ ${next}`;
    }
    card.querySelector('[data-progress]').innerHTML =
        next === null ? '' : progressBarHtml(Math.min(copies, next), next);
    card.querySelector('[data-needed]').innerHTML = neededHtml(level, copies);
    const promote = card.querySelector('[data-promote]');
    promote.hidden = next === null;
    promote.disabled = next === null || copies < next;
    promote.innerHTML = next === null ? '' : tHtml('ravenEpigraph.detail.promote');
}

/**
 * Opens the card of the selected epigraph in the slot under its plan's board and closes the others (a closed slot keeps
 * its old card, hidden). With `scroll`, a card that was not open yet is scrolled into view once it has grown: on a phone
 * little is in view at a time.
 */
function renderDetail({ scroll = false } = {}) {
    const slotOf = (faction) => plan.querySelector(`[data-slot="${faction}"]`);
    const wasOpen = selected ? slotOf(selected.faction).classList.contains('is-open') : false;
    for (const faction of EPIGRAPH_FACTIONS) {
        slotOf(faction).classList.toggle('is-open', selected?.faction === faction);
    }
    if (!selected) {
        card = null;
        return;
    }
    const { epigraph, faction } = selected;
    const itemId = epigraphItemId(epigraph, faction);
    card = slotOf(faction).querySelector('.epigraph-detail');
    card.innerHTML = detailHtml(epigraph, faction);
    const shown = card;
    const change = (patch) => {
        setEpigraph(itemId, patch);
        renderPlan();
        renderStats();
        showDetail();
    };
    shown.querySelectorAll('[data-level-radio]').forEach((radio) => {
        radio.addEventListener('change', () => change({ level: Number(radio.value) }));
    });
    shown.querySelector('[data-copies]').addEventListener('change', (event) => {
        const copies = clampCount(Number(event.target.value));
        event.target.value = copies;
        change({ copies });
    });
    // Promote spends the copies the next level takes and raises the level by one, as in the game.
    shown.querySelector('[data-promote]').addEventListener('click', () => {
        const { level, copies } = epigraphLevel(saved, itemId);
        const next = nextPromotion(level);
        if (next !== null && copies >= next) {
            change({ level: level + 1, copies: copies - next });
        }
    });
    showDetail();
    if (scroll && !wasOpen) {
        setTimeout(() => shown.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), OPEN_MS);
    }
}

/**
 * An epigraph's text (`describeEpigraph`) as markup: a number in green as on the Skill Upgrade Path, and the bonus behind
 * it in orange after a plain plus ("3.2M+500K"); a sign before a number ("targets +2") is plain text too. A percentage
 * shows one decimal as the game writes it ("15.0%+2%"), its bonus as it is. A bonus of 0 (no Raven Evolve boost yet) is
 * left out with its plus, one that isn't known is "?", and a number that isn't known is one "?" without its bonus.
 */
function effectHtml(parts) {
    return parts
        .map((part) => {
            if (typeof part === 'string') {
                return escapeHtml(part);
            }
            const { sign, now, unit, bonus } = part;
            if (now === null) {
                return `${sign}<span class="epigraph-value">?</span>`;
            }
            const shown = unit === '%' ? formatThousands(now, 1) : formatCompact(now);
            const value = `${sign}<span class="epigraph-value">${shown}${unit}</span>`;
            if (!bonus || bonus.now === 0) {
                return value;
            }
            const extra = bonus.now === null ? '?' : `${formatCompact(bonus.now)}${bonus.unit}`;
            return `${value}+<span class="epigraph-bonus">${extra}</span>`;
        })
        .join('');
}

/** The Raven Evolve level the bonus numbers of the texts are for, and the boost it gives. */
function renderEvolve() {
    const level = evolveLevelOf(ravenData, saved);
    const boost = (value) => tHtml('ravenEpigraph.evolve.boost', { boost: evolveBoost(ravenData, value) });
    evolve.innerHTML = `
        <label class="epigraph-evolve__field">
            <span>${tHtml('ravenEpigraph.evolve.label')}</span>
            <input type="number" min="1" max="${ravenData.evolve_max_level}" step="1" value="${level}" data-evolve />
        </label>
        <span class="text-dim" data-boost>${boost(level)}</span>`;
    evolve.querySelector('[data-evolve]').addEventListener('change', (event) => {
        const value = clampEvolve(ravenData, Number(event.target.value));
        event.target.value = value;
        save({ evolveLevel: value });
        evolve.querySelector('[data-boost]').innerHTML = boost(value);
        // A plan that is locked now can't be selected; the boards, the answer and the card follow the level.
        if (selected && !unlockedPlans().includes(selected.faction)) {
            selected = null;
        }
        renderPlan();
        renderStats();
        renderDetail();
    });
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
    const unlocked = unlockedPlans();
    const result = chestEstimate(data, saved, { plans: unlocked });
    const number = (value) => (value === undefined ? t('common.dash') : formatThousands(value));
    const rows = Object.entries(CHESTS).map(([kind, itemId]) => {
        const estimate = result[kind];
        return `<tr>
            <td><span class="item-cell">${itemIconSlot(itemId)}${escapeHtml(itemName(itemId))}</span></td>
            <td class="text-right table-col-fit">${number(estimate?.expected)}</td>
            <td class="text-right table-col-fit">${number(estimate?.safe)}</td>
        </tr>`;
    });
    const locked = EPIGRAPH_FACTIONS.filter((faction) => !unlocked.includes(faction));
    const lockedNote =
        locked.length > 0 && unlocked.length > 0
            ? `<p class="epigraph-note text-dim">${tHtml('ravenEpigraph.resultLocked', { plans: escapeHtml(locked.map((faction) => enumLabel('gear.faction', faction)).join(', ')) })}</p>`
            : '';
    const nothing = result.missing === result.covered;
    const none =
        unlocked.length === 0
            ? 'ravenEpigraph.noPlans'
            : result.missing === 0
              ? 'ravenEpigraph.allMaxed'
              : 'ravenEpigraph.stockCovers';
    const body = nothing
        ? `<p class="epigraph-note">${tHtml(none, { level: Math.min(...Object.values(ravenData.plan_unlock_levels)) })}</p>`
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
        ${body}
        ${lockedNote}`;
    hydrateItemIcons(stats, 'item-icon', itemName);
}

/**
 * "How it works", in the order you use the page: what it does, your epigraphs (sample tiles as the boards draw them, what a
 * click and the card do), what the text on a card means (a sample sentence with its colours), the Raven Evolve level (what
 * it unlocks, from the data), the chests (what each gives, from the data), the answer and your data.
 */
function renderHelp() {
    const { chests, choiceShards, craftShards } = drops;
    const section = (titleKey, body) => `<section><h3>${tHtml(titleKey)}</h3>${body}</section>`;
    const p = (key, vars) => `<p>${tHtml(key, vars)}</p>`;
    const list = (items) => `<ul class="page-details__list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
    const table = (heads, rows) =>
        `<table class="page-details__table"><thead><tr>${heads.map((head) => `<th>${tHtml(head)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    // A sample epigraph at a level, drawn as on the boards (with the copies it still needs from nothing).
    const sample = (level, key) => {
        const need = copiesNeeded(level, 0);
        const pill = need ? `<span class="epigraph-tile__need">${formatThousands(need)}</span>` : '';
        return `<figure class="epigraph-help__sample"><span class="epigraph-help__tile">${artHtml('guard_of_nature', 'warrior', level)}${pill}</span><figcaption>${tHtml(key, { count: formatThousands(need) })}</figcaption></figure>`;
    };
    const value = (text) => `<span class="epigraph-value">${text}</span>`;
    const bonus = (text) => `<span class="epigraph-bonus">${text}</span>`;
    // What each Raven Evolve level reaches: the plans it unlocks (as chips) and the boosts, in the order of the levels.
    const unlocks = new Map();
    const unlock = (level, html) => unlocks.set(level, [...(unlocks.get(level) ?? []), html]);
    EPIGRAPH_FACTIONS.forEach((faction) =>
        unlock(ravenData.plan_unlock_levels[faction], factionHtml(faction, false, true)),
    );
    ravenData.evolve_boost_levels.forEach((level, i) =>
        unlock(level, tHtml('ravenEpigraph.evolve.boost', { boost: i + 1 })),
    );
    const evolveRows = [...unlocks]
        .sort(([x], [y]) => x - y)
        .map(([level, items]) => `<tr><td>${level}</td><td>${items.join(' ')}</td></tr>`);
    // What each chest gives: the chance of a UR epigraph and the shards.
    const chestRows = [
        ...Object.entries(CHESTS).map(([kind, itemId]) => [
            itemId,
            formatPercent(chests[kind].urChance, 0),
            chests[kind].shards,
        ]),
        [CHOICE_CHEST, tHtml('ravenEpigraph.help.chooseOne'), choiceShards],
    ].map(
        ([itemId, copy, shards]) =>
            `<tr><td><span class="item-cell">${itemIconSlot(itemId)}${escapeHtml(itemName(itemId))}</span></td><td>${copy}</td><td>${formatThousands(shards)}</td></tr>`,
    );
    help.innerHTML = [
        section('ravenEpigraph.help.aboutTitle', p('ravenEpigraph.help.aboutText')),
        section(
            'ravenEpigraph.help.epigraphsTitle',
            `<div class="epigraph-help__samples">${sample(0, 'ravenEpigraph.help.sampleNew')}${sample(3, 'ravenEpigraph.help.sampleMid')}${sample(MAX_LEVEL, 'ravenEpigraph.help.sampleMax')}</div>${list(
                [
                    tHtml('ravenEpigraph.help.clickText'),
                    tHtml('ravenEpigraph.help.cardText', {
                        steps: PROMOTE_COPIES.join(', '),
                        total: PROMOTE_COPIES.reduce((sum, step) => sum + step, 0),
                    }),
                ],
            )}`,
        ),
        section(
            'ravenEpigraph.help.textTitle',
            `${p('ravenEpigraph.help.textText')}<p class="epigraph-help__sentence">${tHtml('ravenEpigraph.help.textSample', { value: value('10.0%'), bonus: bonus('4.8%'), target: value('2') })}</p>${list(
                [
                    `${value('10.0%')} ${tHtml('ravenEpigraph.help.textValue')}`,
                    `${bonus('4.8%')} ${tHtml('ravenEpigraph.help.textBonus')}`,
                ],
            )}`,
        ),
        section(
            'ravenEpigraph.help.evolveTitle',
            `${p('ravenEpigraph.help.evolveText')}${table(['ravenEpigraph.help.evolveLevel', 'ravenEpigraph.help.evolveUnlocks'], evolveRows)}`,
        ),
        section(
            'ravenEpigraph.help.chestsTitle',
            `${p('ravenEpigraph.help.chestsText', { craftShards: formatThousands(craftShards) })}${table(['ravenEpigraph.help.chest', 'ravenEpigraph.help.chestUr', 'ravenEpigraph.help.chestShards'], chestRows)}`,
        ),
        section(
            'ravenEpigraph.help.answerTitle',
            list([
                `<strong>${tHtml('ravenEpigraph.expected')}</strong>: ${tHtml('ravenEpigraph.help.answerExpected')}`,
                `<strong>${tHtml('ravenEpigraph.safe')}</strong>: ${tHtml('ravenEpigraph.help.answerSafe')}`,
                tHtml('ravenEpigraph.help.answerLast'),
            ]),
        ),
        section('ravenEpigraph.help.savedTitle', p('ravenEpigraph.help.savedText')),
    ].join('');
    hydrateItemIcons(help, 'item-icon', itemName);
}

function render() {
    renderHelp();
    renderEvolve();
    renderFrames();
    renderPlan();
    renderStock();
    renderStats();
    renderDetail();
}

function init(loaded) {
    data = loaded;
    drops = chestDrops(data);
    saved = readJson(STORAGE_KEYS.epigraphs);
    render();
}

startPage('raven-epigraph', { init, onLocaleChange: () => render() });

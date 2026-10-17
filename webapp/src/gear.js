/**
 * Gear Path: a squad's formation (front row of tanks, back row of carries and the support) with each hero's
 * gear in a 2×2 square, and the guide to its UR gear (`squad_guides` in pack_data.json) in two phases:
 * 1. Crafting: every hero gets all their UR pieces first, step by step.
 * 2. Upgrades, unlocked after crafting: two queues, one card each (the next level step and the next star step). Which
 *    one to take depends on what you have (star steps use Gear Blueprints). Levels and stars wait for each other
 *    (lib/gear-path.js works out what a step needs); a blocked step says what it needs first.
 * The hero factions (Warriors, Rangers, Warlocks) share the paths; each slot has a hero per faction. The progress
 * (steps done per queue) is saved in this browser, per faction.
 */
import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { applyStaticTranslations, getLocale, localizedName, t } from './lib/i18n';
import { createItemImage } from './lib/images';
import { escapeHtml } from './lib/labels';
import { formatThousands } from './lib/format';
import {
    MR_STEP,
    applyStep,
    crossNeeds,
    initialState,
    mergePaths,
    starIcons,
    starsOfStep,
    stepCost,
    stepItems,
    stepSlots,
} from './lib/gear-path.js';

renderNav('gear');
applyStaticTranslations();

const ASSETS = `${import.meta.env.BASE_URL}assets/`;
const STORAGE_KEY = 'lasps_gear_progress';
const PATHS = ['craft', 'level', 'stars'];
const UPGRADES = ['level', 'stars'];
// In this order on the faction switch.
const FACTIONS = ['warrior', 'ranger', 'warlock'];
// The page's icons: the same in the guide and in "How it works". Factions and classes have the game's images
// (assets/factions, assets/classes).
const LANE_ICONS = { craft: '🔨', level: '⬆', stars: '★' };
const ACTION_ICONS = { done: '✓', undo: '↶', craftAll: '⏭', startOver: '↺', hold: '⏸', blocked: '⛔' };

const factionSwitch = document.getElementById('gear-factions');
const layout = document.getElementById('gear-layout');
const board = document.getElementById('gear-board');
const guidePanel = document.getElementById('gear-guide');
const help = document.getElementById('gear-help');

let data = null;
let guideId = null;
let guide = null;
let gearSet = null;
// The factions with a hero in every slot, and the one shown.
let factions = [];
let shownFaction = null;
// The three paths merged (mergePaths: crafting first, levels and stars in an order that keeps their
// dependencies), and per path its entries in its own order.
let merged = [];
let entriesOf = {};
// The progress: per queue the steps done (by their position n in that queue), in the order they were done (for
// Undo). Steps can be done out of order: the 5 ★ steps wait while there's no Gear Blueprint (MR) (`mrOnHold`).
const done = { craft: [], level: [], stars: [] };
let mrOnHold = false;
// Which full step lists are open ("Show all steps"), kept across re-renders.
const openLists = new Set();

const itemName = (itemId) => localizedName(data.items[itemId]?.name) || itemId;
const heroName = (heroId) => localizedName(data.heroes?.[heroId]?.name) || heroId;
// A slot's hero in the faction shown.
const heroOf = (slot) => guide.slots[slot]?.heroes?.[shownFaction];
const heroImage = (heroId) => `${ASSETS}heroes/${escapeHtml(data.heroes?.[heroId]?.image ?? heroId)}.png`;
const icon = (symbol) => `<span class="gear-icon" aria-hidden="true">${symbol}</span>`;
const factionIcon = (faction) => `<img class="gear-badge" src="${ASSETS}factions/${faction}.png" alt="" />`;
const classIcon = (heroClass) => `<img class="gear-badge" src="${ASSETS}classes/${heroClass}.png" alt="" />`;
// "★ Stars": a lane's name with its icon (plain text, for texts that are escaped as a whole).
const laneName = (path) => `${LANE_ICONS[path]} ${t(`gear.lane.${path}`)}`;
const formatStars = (stars) => stars.toLocaleString(getLocale(), { maximumFractionDigits: 1 });
const isDone = (entry) => done[entry.path].includes(entry.n);
const doneCount = (path) => done[path].length;
const craftComplete = () => doneCount('craft') >= entriesOf.craft.length;
// A 5 ★ step: it uses the gear set's MR blueprint.
const isMrStep = (entry) => entry.path === 'stars' && entry.step.stars === 5;
const isHeld = (entry) => mrOnHold && isMrStep(entry) && !isDone(entry);

/**
 * Per level / star entry: the step of the other queue it needs done first (`needs`: { path, n, stars | level }), from
 * crossNeeds (Lv 60 needs 4 stars, stars need their minimum level); null if none.
 */
function addRequirements() {
    // Each path in its own order (crossNeeds): a step the other path never makes possible gets `n: null` and
    // stays blocked.
    const cross = crossNeeds(guide, gearSet);
    for (const entry of merged) {
        entry.needs = entry.kind === 'craft' ? null : cross[entry.path][entry.n];
    }
}

/** A queue's next step: its first step not done yet (and not on hold). */
function nextOf(path) {
    return entriesOf[path].find((entry) => !isDone(entry) && !isHeld(entry)) || null;
}

/** A step can be done now: crafting is complete (for upgrades) and the step it needs from the other queue is done. */
function canDo(entry) {
    if (entry.kind === 'craft') {
        return true;
    }
    return (
        craftComplete() && (!entry.needs || (entry.needs.n !== null && done[entry.needs.path].includes(entry.needs.n)))
    );
}

/** A done step can be undone: crafting only while nothing is upgraded; an upgrade only while no done step needs it. */
function canUndoEntry(entry) {
    if (entry.kind === 'craft') {
        return doneCount('level') === 0 && doneCount('stars') === 0;
    }
    return !merged.some((other) => isDone(other) && other.needs?.path === entry.path && other.needs.n === entry.n);
}

function canAdvance(path) {
    const next = nextOf(path);
    return Boolean(next) && canDo(next);
}

/** The step Undo takes back: the queue's last done one. */
function lastDone(path) {
    const n = done[path].at(-1);
    return n === undefined ? null : entriesOf[path][n];
}

function canUndo(path) {
    const last = lastDone(path);
    return Boolean(last) && canUndoEntry(last);
}

/**
 * This guide's saved progress: `{ faction, warrior: { craft, level, stars, mrOnHold }, ranger: …, warlock: … }`
 * (the faction shown last, and per faction its progress). Older saves held one squad's progress directly: the warriors'.
 */
function savedProgress() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')[guideId] || {};
        return PATHS.some((path) => path in saved) ? { warrior: saved } : saved;
    } catch {
        // localStorage may be unavailable or hold something else: start fresh.
        return {};
    }
}

/** The progress of the faction shown (none saved yet: nothing done). */
function loadProgress() {
    const saved = savedProgress()[shownFaction] || {};
    for (const path of PATHS) {
        // Saved as a list of done steps; older saves stored a count (the first n steps).
        const list = Array.isArray(saved[path])
            ? saved[path]
            : Array.from({ length: Number(saved[path]) || 0 }, (_, n) => n);
        done[path] = [...new Set(list.filter((n) => Number.isInteger(n) && n >= 0 && n < entriesOf[path].length))];
    }
    mrOnHold = Boolean(saved.mrOnHold);
    // The guide may have changed since: keep only progress that is still possible.
    if (!craftComplete()) {
        done.level = [];
        done.stars = [];
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const path of UPGRADES) {
            const keep = done[path].filter((n) => {
                const needs = entriesOf[path][n].needs;
                return !needs || done[needs.path].includes(needs.n);
            });
            if (keep.length !== done[path].length) {
                done[path] = keep;
                changed = true;
            }
        }
    }
}

function saveProgress() {
    try {
        const all = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
        all[guideId] = {
            ...savedProgress(),
            faction: shownFaction,
            [shownFaction]: { craft: done.craft, level: done.level, stars: done.stars, mrOnHold },
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
        // localStorage may be unavailable (private browsing, etc.)
    }
}

function commit() {
    saveProgress();
    renderProgress();
}

/** Done (+1: the queue's next step) or Undo (-1: its last done step). */
function advance(path, direction) {
    if (direction > 0) {
        if (canAdvance(path)) {
            done[path].push(nextOf(path).n);
        }
    } else if (canUndo(path)) {
        done[path].pop();
    }
    commit();
}

/**
 * A click on a step in a full list: the steps before it done (as far as allowed; steps on hold stay out), the step
 * itself and those after it undone (as far as allowed).
 */
function jumpTo(path, position) {
    const entries = entriesOf[path];
    let undone = true;
    while (undone) {
        undone = false;
        const latest = [...done[path]].reverse().find((n) => n >= position);
        if (latest !== undefined && canUndoEntry(entries[latest])) {
            done[path] = done[path].filter((n) => n !== latest);
            undone = true;
        }
    }
    for (const entry of entries.slice(0, position)) {
        if (isDone(entry) || isHeld(entry)) {
            continue;
        }
        if (!canDo(entry)) {
            break;
        }
        done[path].push(entry.n);
    }
    commit();
}

/** The "no Gear Blueprint (MR) yet" switch: the 5 ★ steps wait (or come back, in their order). */
function setMrOnHold(value) {
    mrOnHold = value;
    commit();
}

/** "All crafted": every crafting step not done yet, in the path's order. */
function craftAll() {
    for (const entry of entriesOf.craft) {
        if (!isDone(entry)) {
            done.craft.push(entry.n);
        }
    }
    commit();
}

/** Start over: the faction shown only. */
function startOver() {
    done.craft = [];
    done.level = [];
    done.stars = [];
    commit();
}

/** Another faction: its heroes and its own progress. */
function setFaction(faction) {
    shownFaction = faction;
    loadProgress();
    saveProgress();
    render();
}

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
    let state = initialState(guide, gearSet);
    for (const entry of merged) {
        if (isDone(entry)) {
            state = applyStep(state, entry.step, guide, gearSet);
        }
    }
    const upcoming = new Map();
    for (const path of PATHS) {
        const next = nextOf(path);
        if (!next || !canDo(next)) {
            continue;
        }
        for (const slot of stepSlots(guide, next.step)) {
            for (const item of stepItems(gearSet, next.step)) {
                const piece = state[slot]?.[item];
                const changes =
                    next.kind === 'craft'
                        ? !piece?.crafted
                        : next.kind === 'level'
                          ? piece?.level < next.step.level
                          : piece?.starStep < (next.step.stars === 5 ? MR_STEP : Math.round(next.step.stars * 5));
                if (changes) {
                    const key = `${slot}:${item}`;
                    upcoming.set(key, [...(upcoming.get(key) || []), { path, text: previewText(next) }]);
                }
            }
        }
    }
    return { state, upcoming };
}

function tileHtml(state, upcoming, slot, item) {
    const piece = state[slot][item];
    const next = upcoming.get(`${slot}:${item}`) || [];
    const classes = [
        'gear-tile',
        piece.crafted ? '' : 'gear-tile--empty',
        ...next.map(({ path }) => `gear-tile--next-${path}`),
        piece.starStep === MR_STEP ? 'gear-tile--mr' : '',
    ].filter(Boolean);
    const label = piece.crafted
        ? t('gear.tileLabel', {
              item: itemName(item),
              level: piece.level,
              stars: formatStars(starsOfStep(piece.starStep)),
          })
        : t('gear.tileNotCrafted', { item: itemName(item) });
    const starsHtml = starIcons(piece.starStep)
        .map((name) => `<img src="${ASSETS}stars/${name}.png" alt="" />`)
        .join('');
    return `
        <div class="${classes.join(' ')}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" role="img">
            <span class="gear-tile__level">${piece.crafted ? t('gear.level', { level: piece.level }) : '–'}</span>
            <span data-item-id="${item}"></span>
            <span class="gear-tile__stars">${starsHtml}</span>
            <span class="gear-tile__next">${next.map(({ path, text }) => `<span class="gear-tile__next--${path}">${escapeHtml(text)}</span>`).join(' ')}</span>
        </div>`;
}

function slotHtml(state, upcoming, slot) {
    const { class: heroClass } = guide.slots[slot];
    const hero = heroOf(slot);
    const name = heroName(hero);
    const square = gearSet.layout
        .flat()
        .map((item) => tileHtml(state, upcoming, slot, item))
        .join('');
    return `
        <div class="gear-slot">
            <figure class="gear-hero">
                <img src="${heroImage(hero)}" alt="${escapeHtml(name)}" />
                <figcaption>
                    <strong>${escapeHtml(name)}</strong>
                    <span class="gear-class gear-class--${heroClass}">${classIcon(heroClass)}${escapeHtml(t(`gear.class.${heroClass}`))}</span>
                </figcaption>
            </figure>
            <div class="gear-square">${square}</div>
        </div>`;
}

function renderBoard() {
    const { state, upcoming } = shownState();
    const row = (slots, labelKey) => `
        <div class="gear-row">
            <div class="gear-row__label">${escapeHtml(t(labelKey))}</div>
            <div class="gear-row__slots">${slots.map((slot) => slotHtml(state, upcoming, slot)).join('')}</div>
        </div>`;
    board.innerHTML = row(guide.formation.front, 'gear.frontRow') + row(guide.formation.back, 'gear.backRow');
    board.style.setProperty('--faction-color', `var(--faction-${shownFaction})`);
    replaceItemIcons(board, 'item-icon');
}

/** Warriors | Rangers | Warlocks, each in its colour (only with more than one faction). */
function renderFactions() {
    factionSwitch.hidden = factions.length < 2;
    factionSwitch.setAttribute('aria-label', t('gear.factions'));
    factionSwitch.innerHTML = factions
        .map(
            (faction) => `
            <button type="button" class="gear-faction${faction === shownFaction ? ' is-active' : ''}" data-faction="${faction}" style="--faction-color: var(--faction-${faction})" aria-pressed="${faction === shownFaction}">
                ${factionIcon(faction)} ${escapeHtml(t(`gear.faction.${faction}`))}
            </button>`,
        )
        .join('');
    factionSwitch.querySelectorAll('[data-faction]').forEach((button) => {
        button.addEventListener('click', () => setFaction(button.dataset.faction));
    });
}

function replaceItemIcons(root, className) {
    root.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        placeholder.replaceWith(createItemImage(itemId, itemName(itemId), className));
    });
}

/** "Carries", "Tanks", "Whole squad" or the heroes' names. */
function whoText(step) {
    if (step.slots === 'all') {
        return t('gear.wholeSquad');
    }
    const slots = stepSlots(guide, step);
    const classes = [...new Set(slots.map((slot) => guide.slots[slot]?.class))];
    if (classes.length === 1 && slots.length > 1) {
        const ofClass = Object.keys(guide.slots).filter((slot) => guide.slots[slot].class === classes[0]);
        if (ofClass.every((slot) => slots.includes(slot))) {
            return t(`gear.group.${classes[0]}`);
        }
    }
    return slots.map((slot) => heroName(heroOf(slot))).join(', ');
}

/** The 5 star icons for a star step's target, or for a number of whole stars (5 = MR). */
function starStripHtml(stars, className = 'gear-stars') {
    const step = stars === 5 ? MR_STEP : Math.round(stars * 5);
    return `<span class="${className}" aria-hidden="true">${starIcons(step)
        .map((name) => `<img src="${ASSETS}stars/${name}.png" alt="" />`)
        .join('')}</span>`;
}

/**
 * A step in pictures and words: the heroes' portraits, the pieces' icons, "Carries · UR Sword → 2 ★" and, for star
 * steps, the target's star strip.
 */
function stepHtml(entry) {
    const faces = stepSlots(guide, entry.step)
        .map((slot) => `<img class="gear-face" src="${heroImage(heroOf(slot))}" alt="" />`)
        .join('');
    const pieces = stepItems(gearSet, entry.step)
        .map((item) => `<span data-item-id="${item}"></span>`)
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
    const itemsText = items === 'all' ? t('gear.allGear') : stepItems(gearSet, entry.step).map(itemName).join(', ');
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
    const source = n === null ? null : entriesOf[path][n];
    if (stars) {
        const params = {
            level: entry.step.level,
            stars,
            below: stars - 1,
            cap: gearSet.level_cap_by_stars?.[stars - 1],
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
    const cost = stepCost(entry.before, entry.step, guide, gearSet);
    if (!cost || Object.keys(cost).length === 0) {
        return '';
    }
    const parts = Object.entries(cost)
        .map(
            ([itemId, qty]) =>
                `<span class="gear-cost__part"><span data-item-id="${itemId}"></span>${formatThousands(qty)}</span>`,
        )
        .join('');
    return `<div class="gear-cost">${parts}</div>`;
}

/** The blueprint a star step uses (UR stars, or the MR step to 5 stars). */
function blueprintOf(entry) {
    return entry.step.stars === 5 ? gearSet.blueprints?.mr : gearSet.blueprints?.ur;
}

function progressBarHtml(done, total) {
    const percent = total ? Math.round((done / total) * 100) : 0;
    return `<div class="gear-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width: ${percent}%"></span></div>`;
}

/** The full list of a queue, behind "Show all steps"; clicking a step marks everything up to it done. */
function listHtml(path) {
    const entries = entriesOf[path];
    const steps = entries
        .map((entry, i) => {
            const need = path === 'craft' ? null : needOf(entry);
            let needHtml = '';
            if (need && !need.source) {
                needHtml = `<span class="gear-gate gear-gate--never">${ACTION_ICONS.blocked} ${escapeHtml(need.blocked)}</span>`;
            } else if (need) {
                const met = isDone(need.source);
                needHtml = `<span class="gear-gate${met ? ' gear-gate--done' : ''}">${met ? '✓' : '○'} ${escapeHtml(need.gate)}</span>`;
            }
            const problem = entry.problems.length
                ? `<span class="gear-path__problem text-bad">${escapeHtml(t('gear.problem'))}</span>`
                : '';
            return `
                <li class="gear-path__step${isDone(entry) ? ' is-done' : ''}${entry === nextOf(path) ? ' is-next' : ''}${isHeld(entry) ? ' is-held' : ''}" data-path="${path}" data-position="${i + 1}">
                    <button type="button" class="gear-path__button">
                        <span class="gear-path__number">${i + 1}</span>
                        <span class="gear-path__check" aria-hidden="true"></span>
                        <span class="gear-path__body">
                            <span class="gear-path__text">${stepHtml(entry)}</span>
                            ${isHeld(entry) ? `<span class="gear-path__held">${ACTION_ICONS.hold} ${escapeHtml(t('gear.onHold'))}</span>` : ''}${needHtml}${costHtml(entry)}${problem}
                        </span>
                    </button>
                </li>`;
        })
        .join('');
    return `
        <details class="gear-list" data-list="${path}"${openLists.has(path) ? ' open' : ''}>
            <summary>${escapeHtml(t('gear.showAll', { path: laneName(path), count: entries.length }))}</summary>
            <ol class="gear-path">${steps}</ol>
        </details>`;
}

/** "No Gear Blueprint (MR) yet": puts the 5 ★ steps on hold (shown while any is still open). */
function holdSwitchHtml() {
    const open = entriesOf.stars.filter((entry) => isMrStep(entry) && !isDone(entry)).length;
    const blueprint = gearSet.blueprints?.mr;
    if (!open || !blueprint) {
        return '';
    }
    return `
        <label class="gear-hold">
            <input type="checkbox" data-action="hold"${mrOnHold ? ' checked' : ''} />
            <span data-item-id="${blueprint}"></span>
            <span>${escapeHtml(t('gear.holdMr', { item: itemName(blueprint) }))}</span>
        </label>`;
}

/** "⛔ Lv 60 needs 4 ★ first (3 ★ only allow up to Lv 56)." */
function blockedHtml(need) {
    return `<div class="gear-next__blocked"><p>${ACTION_ICONS.blocked} ${escapeHtml(need.blocked)}</p></div>`;
}

/** A button's label with its icon: "✓ Done". */
const actionLabel = (action) => `${icon(ACTION_ICONS[action])} ${escapeHtml(t(`gear.${action}`))}`;

/**
 * The card of a queue's next step: what to do and what it uses, Done and Undo (+ "All crafted" while crafting), and
 * below the buttons (so they stay put) what it needs first and the stars card's MR switch.
 */
function nextCardHtml(path, titleKey) {
    const entries = entriesOf[path];
    const next = nextOf(path);
    const locked = path !== 'craft' && !craftComplete();
    const held = path === 'stars' ? entries.filter(isHeld).length : 0;
    let body;
    let blocked = '';
    if (!next) {
        body = held
            ? `<p class="gear-next__held">${ACTION_ICONS.hold} ${escapeHtml(t('gear.onlyHeldLeft', { count: held }))}</p>`
            : `<p class="gear-next__done">✓ ${escapeHtml(t(`gear.allDone.${path}`))}</p>`;
    } else {
        const blueprint = path === 'stars' ? blueprintOf(next) : null;
        const uses = blueprint
            ? `<p class="gear-next__uses">${escapeHtml(t('gear.uses'))} <span data-item-id="${blueprint}"></span> ${escapeHtml(itemName(blueprint))}</p>`
            : '';
        const need = path === 'craft' || locked || canAdvance(path) ? null : needOf(next);
        blocked = need ? blockedHtml(need) : '';
        body = `
            <p class="gear-next__step">${stepHtml(next)}</p>
            ${uses}${costHtml(next)}`;
    }
    const craftAllButton =
        path === 'craft' && !craftComplete()
            ? `<button type="button" class="gear-next__secondary" data-action="craft-all">${actionLabel('craftAll')}</button>`
            : '';
    return `
        <div class="gear-next gear-next--${path}${locked ? ' is-locked' : ''}">
            <div class="gear-next__head">
                <h4>${icon(LANE_ICONS[path])} ${escapeHtml(t(titleKey))}</h4>
                <span class="gear-next__count">${escapeHtml(t('gear.count', { done: doneCount(path), total: entries.length }))}</span>
            </div>
            ${progressBarHtml(doneCount(path), entries.length)}
            ${body}
            <div class="gear-next__actions">
                <button type="button" class="gear-next__done-button" data-action="done" data-path="${path}"${canAdvance(path) ? '' : ' disabled'}>${actionLabel('done')}</button>
                <button type="button" class="gear-next__secondary" data-action="undo" data-path="${path}"${canUndo(path) ? '' : ' disabled'} title="${escapeHtml(path === 'craft' && doneCount(path) > 0 && !canUndo(path) ? t('gear.undoCraftBlocked') : '')}">${actionLabel('undo')}</button>
                ${craftAllButton}
            </div>
            ${blocked}
            ${path === 'stars' ? holdSwitchHtml() : ''}
        </div>`;
}

/** While the 5 ★ steps are on hold: how many wait, for which blueprint. */
function heldNoteHtml() {
    const held = entriesOf.stars.filter(isHeld).length;
    const blueprint = gearSet.blueprints?.mr;
    if (!held || !blueprint) {
        return '';
    }
    return `<p class="gear-held-note">${ACTION_ICONS.hold} ${escapeHtml(t('gear.heldNote', { count: held }))} <span data-item-id="${blueprint}"></span> ${escapeHtml(itemName(blueprint))}</p>`;
}

function renderGuide() {
    const locked = !craftComplete();
    guidePanel.innerHTML = `
        <div class="gear-guide__head">
            <h3>${escapeHtml(t('gear.progressTitle'))}</h3>
            <button type="button" class="gear-guide__reset" data-action="reset"${doneCount('craft') + doneCount('level') + doneCount('stars') === 0 ? ' disabled' : ''}>${actionLabel('startOver')}</button>
        </div>
        <section class="gear-phase${craftComplete() ? ' is-complete' : ''}">
            <h3 class="gear-phase__title"><span class="gear-phase__number">1</span>${escapeHtml(t('gear.phaseCraft'))}</h3>
            ${nextCardHtml('craft', 'gear.nextCraft')}
            ${listHtml('craft')}
        </section>
        <section class="gear-phase${locked ? ' is-locked' : ''}">
            <h3 class="gear-phase__title"><span class="gear-phase__number">2</span>${escapeHtml(t('gear.phaseUpgrades'))}</h3>
            <p class="gear-phase__hint">${escapeHtml(locked ? t('gear.locked', { count: entriesOf.craft.length }) : t('gear.choiceHint'))}</p>
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

/** A button inside a help sentence, as it looks on the page: "✓ Done". */
const chipHtml = (action) => `<span class="gear-chip">${actionLabel(action)}</span>`;

/** A text with HTML in some of its placeholders (`html`); the text itself and `params` are escaped. */
function richText(key, html = {}, params = {}) {
    const names = Object.keys(html);
    const tokens = Object.fromEntries(names.map((name, i) => [name, `\u0001${i}\u0001`]));
    let text = escapeHtml(t(key, { ...params, ...tokens }));
    names.forEach((name) => {
        text = text.replace(tokens[name], html[name]);
    });
    return text;
}

/**
 * "How it works", in the order you use the page: what it does, the faction, reading the squad, crafting, upgrading,
 * blocked steps (rules from the data and an example from the path), the MR switch, mistakes and saving.
 */
function renderHelp() {
    const section = (symbol, titleKey, body) => `
        <section>
            <h3>${icon(symbol)} ${escapeHtml(t(titleKey))}</h3>
            ${body}
        </section>`;
    const p = (key, html, params) => `<p>${richText(key, html, params)}</p>`;
    const itemHtml = (item) =>
        `<span class="gear-help__piece"><span data-item-id="${item}"></span>${escapeHtml(itemName(item))}</span>`;
    const blueprints = gearSet.blueprints || {};

    // The squad: the factions (as on the switch), the formation with the heroes of the faction shown.
    const factionChips = factions
        .map(
            (faction) =>
                `<span class="gear-faction gear-faction--chip${faction === shownFaction ? ' is-active' : ''}" style="--faction-color: var(--faction-${faction})">${factionIcon(faction)} ${escapeHtml(t(`gear.faction.${faction}`))}</span>`,
        )
        .join('');
    const slotChip = (slot) => {
        const { class: heroClass } = guide.slots[slot];
        return `<span class="gear-help__slot"><img class="gear-face" src="${heroImage(heroOf(slot))}" alt="" />${classIcon(heroClass)}${escapeHtml(t(`gear.class.${heroClass}`))} <span class="text-dim">${escapeHtml(heroName(heroOf(slot)))}</span></span>`;
    };
    const formation = `
        <div class="gear-help__formation">
            <div class="gear-help__row"><span class="gear-help__row-label">${escapeHtml(t('gear.frontRow'))}</span>${guide.formation.front.map(slotChip).join('')}</div>
            <div class="gear-help__row"><span class="gear-help__row-label">${escapeHtml(t('gear.backRow'))}</span>${guide.formation.back.map(slotChip).join('')}</div>
        </div>`;

    // Reading the squad: the 2×2 square, and sample tiles drawn like the board's.
    const [sampleItem] = gearSet.layout.flat();
    const upgraded = { crafted: true, level: 40, starStep: 12 };
    const notCrafted = { crafted: false, level: 0, starStep: 0 };
    const sample = (piece, caption, path = null, text = '') => {
        const upcoming = new Map(path ? [[`sample:${sampleItem}`, [{ path, text }]]] : []);
        return `<figure class="gear-help__sample">${tileHtml({ sample: { [sampleItem]: piece } }, upcoming, 'sample', sampleItem)}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
    };
    const pieceSamples = [sample(upgraded, t('gear.help.tileUpgraded')), sample(notCrafted, t('gear.help.tileEmpty'))];
    const nextSamples = [
        sample(notCrafted, laneName('craft'), 'craft', t('gear.previewCraft')),
        sample(upgraded, laneName('level'), 'level', `→ ${t('gear.toLevel', { level: 50 })}`),
        sample(upgraded, laneName('stars'), 'stars', `→ ${t('gear.toStars', { stars: formatStars(3) })}`),
    ];

    // Upgrading: the two lists and the blueprints the star steps use.
    const blueprintHtml = (id) =>
        id ? `<span class="gear-help__piece"><span data-item-id="${id}"></span>${escapeHtml(itemName(id))}</span>` : '';
    const upgradeCards = `
        <div class="gear-help__cards">
            <div class="gear-help__card gear-help__card--level">
                <h4>${icon(LANE_ICONS.level)} ${escapeHtml(t('gear.lane.level'))}</h4>
                ${p('gear.help.levelText', {}, { max: gearSet.max_level })}
            </div>
            <div class="gear-help__card gear-help__card--stars">
                <h4>${icon(LANE_ICONS.stars)} ${escapeHtml(t('gear.lane.stars'))}</h4>
                ${p('gear.help.starsText', { ur: blueprintHtml(blueprints.ur), mr: blueprintHtml(blueprints.mr) })}
                <div class="gear-help__star-example">${starStripHtml(2, 'gear-help__stars')} → ${starStripHtml(4, 'gear-help__stars')} → ${starStripHtml(5, 'gear-help__stars')}</div>
            </div>
        </div>`;

    // Blocked steps: the rules from the data, and the first level step of the path that waits for a star step.
    const rows = [0, 1, 2, 3, 4, 5]
        .map((stars) => {
            const needs = gearSet.min_level_for_star?.[stars];
            const cap = stars < 5 ? gearSet.level_cap_by_stars?.[stars] : gearSet.max_level;
            return `<tr>
                <td>${starStripHtml(stars, 'gear-help__stars')} <span class="text-dim">${stars === 5 ? t('gear.toMr') : `${stars} ★`}</span></td>
                <td class="text-right">${needs ? escapeHtml(t('gear.level', { level: needs })) : '–'}</td>
                <td class="text-right">${cap ? escapeHtml(t('gear.level', { level: cap })) : '–'}</td>
            </tr>`;
        })
        .join('');
    const example = entriesOf.level.find((entry) => entry.needs && entry.needs.n !== null);
    const exampleHtml = example
        ? `
        <div class="gear-help__example">
            <div class="gear-next gear-next--level">
                <div class="gear-next__head"><h4>${icon(LANE_ICONS.level)} ${escapeHtml(t('gear.nextLevel'))}</h4></div>
                <p class="gear-next__step">${stepHtml(example)}</p>
                <div class="gear-next__actions"><span class="gear-chip is-disabled">${actionLabel('done')}</span></div>
                ${blockedHtml(needOf(example))}
            </div>
        </div>`
        : '';

    help.innerHTML = [
        section('🧭', 'gear.help.aboutTitle', p('gear.help.aboutText')),
        section(
            '👥',
            'gear.help.squadTitle',
            `<div class="gear-help__classes">${factionChips}</div>${p('gear.help.squadText')}${p('gear.help.formationText')}${formation}`,
        ),
        section(
            '🔍',
            'gear.help.boardTitle',
            `${p('gear.help.boardText')}
            <div class="gear-help__square">${gearSet.layout.flat().map(itemHtml).join('')}</div>
            ${p('gear.help.tileText')}
            <div class="gear-help__samples">${pieceSamples.join('')}</div>
            ${p('gear.help.nextText')}
            <div class="gear-help__samples">${nextSamples.join('')}</div>`,
        ),
        section(
            LANE_ICONS.craft,
            'gear.help.craftTitle',
            p('gear.help.craftText', { done: chipHtml('done') }, { count: entriesOf.craft.length }) +
                p('gear.help.craftAllText', { craftAll: chipHtml('craftAll') }) +
                p('gear.help.craftUnlock'),
        ),
        section(
            `${LANE_ICONS.level} ${LANE_ICONS.stars}`,
            'gear.help.upgradesTitle',
            `${p('gear.help.upgradesText')}${upgradeCards}<p class="gear-help__decision">${blueprints.ur ? `<span data-item-id="${blueprints.ur}"></span>` : ''}${escapeHtml(t('gear.choiceHint'))}</p>`,
        ),
        section(
            ACTION_ICONS.blocked,
            'gear.help.blockedTitle',
            `${p('gear.help.blockedIntro')}
            <div class="table-wrap">
                <table class="gear-help__rules">
                    <thead><tr>
                        <th>${escapeHtml(t('gear.help.rulesStars'))}</th>
                        <th class="text-right">${escapeHtml(t('gear.help.rulesNeeds'))}</th>
                        <th class="text-right">${escapeHtml(t('gear.help.rulesMax'))}</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            ${p('gear.help.blockedText', { blocked: ACTION_ICONS.blocked })}
            ${exampleHtml}`,
        ),
        blueprints.mr
            ? section(
                  ACTION_ICONS.hold,
                  'gear.help.holdTitle',
                  p('gear.help.holdText', { item: blueprintHtml(blueprints.mr) }),
              )
            : '',
        section(
            ACTION_ICONS.undo,
            'gear.help.fixTitle',
            `<ul class="gear-help__steps">
                <li>${richText('gear.help.undoText', { undo: chipHtml('undo') })}</li>
                <li>${richText('gear.help.listText')}</li>
                <li>${richText('gear.help.resetText', { startOver: chipHtml('startOver') })}</li>
                <li>${richText('gear.help.savedText')}</li>
            </ul>`,
        ),
    ].join('');
    help.querySelectorAll('.gear-help__example, .gear-help__samples').forEach((root) =>
        replaceItemIcons(root, root.matches('.gear-help__samples') ? 'item-icon' : 'item-icon item-icon--xs'),
    );
    replaceItemIcons(help, 'item-icon item-icon--sm');
}

function render() {
    renderFactions();
    renderHelp();
    renderProgress();
}

async function init() {
    data = await loadPackData();
    [guideId] = Object.keys(data.squad_guides || {});
    guide = guideId ? data.squad_guides[guideId] : null;
    gearSet = guide ? data.gear_upgrades?.[guide.gear] : null;
    factions = guide
        ? FACTIONS.filter((faction) =>
              Object.values(guide.slots).every((slot) => data.heroes?.[slot.heroes?.[faction]]),
          )
        : [];
    if (!guide || !gearSet || factions.length === 0) {
        document.getElementById('gear-empty').hidden = false;
        return;
    }
    merged = mergePaths(guide, gearSet);
    entriesOf = {
        craft: merged.filter((entry) => entry.path === 'craft').sort((a, b) => a.n - b.n),
        level: merged.filter((entry) => entry.path === 'level').sort((a, b) => a.n - b.n),
        stars: merged.filter((entry) => entry.path === 'stars').sort((a, b) => a.n - b.n),
    };
    addRequirements();
    // The faction shown last (the first one the first time).
    const { faction: lastFaction } = savedProgress();
    shownFaction = factions.includes(lastFaction) ? lastFaction : factions[0];
    loadProgress();
    layout.hidden = false;
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        render();
    });
    render();
}

init().catch((error) => {
    console.error(error);
    document
        .querySelector('main')
        .insertAdjacentHTML(
            'afterbegin',
            `<div class="card"><p class="text-bad">${t('common.loadError', { message: escapeHtml(error.message) })}</p></div>`,
        );
});

/**
 * Lord Specialty: a planner for the two lords' talents (specialty skills, `data/lord_specialty.json`), drawn like the
 * game's tree: a spine from Lv.1 at the bottom up, with a badge per unlock level and that level's two talents left
 * and right of it (hexagons are active talents, squares passive ones). Left click adds a point, right click removes
 * one; hovering a talent shows what it does. On a phone (no hover) a tap adds a point and shows the talent, a long
 * press removes one. The talents of later seasons (Lv.45/50) only show with the preview switch.
 *
 * The bar says what the build requires (the lord's level, and extra points only once the season's levels don't give
 * enough) and how many of the player's points are left: their Specialty level and extra Specialty Skill Points,
 * entered above the tree. The rules live in core/lord-specialty.js.
 *
 * The lord and the build are in the URL, so a link shares the build. This browser saves the player's level and extra
 * points, the lord and every lord's build: the page without a link opens them again. A shared link shows its build,
 * saved (over the player's own) only once they change something.
 */
import { startPage } from '../ui/page.js';
import { localizedName, t, tHtml } from '../ui/i18n.js';
import { escapeHtml } from '../ui/html.js';
import { formatThousands } from '../ui/format.js';
import lordData from '../../../data/lord_specialty.json';
import {
    changeTalent,
    decodeBuild,
    emptyBuild,
    encodeBuild,
    isLocked,
    isOutOfSeason,
    isReachable,
    pointsLeft,
    raiseBlock,
    requirements,
    talentRows,
    talentValue,
} from '../core/lord-specialty.js';

const ICONS = `${import.meta.env.BASE_URL}assets/lord/`;
// How long the bar shows a note ("Link copied", why a click changed nothing).
const NOTE_MS = 3000;
// A touch held this long removes a point (phones have no right click).
const LONG_PRESS_MS = 500;
// A touch that moves further is a scroll, not a press.
const TOUCH_SLOP_PX = 10;
const STORAGE_KEY = 'lasps_lord_setup';
// Highest extra points the input takes.
const MAX_EXTRA = 999;

const controls = document.getElementById('lord-controls');
const intro = document.getElementById('lord-intro');
const tree = document.getElementById('lord-tree');
const detail = document.getElementById('lord-detail');
const bar = document.getElementById('lord-bar');
const previewSwitch = document.getElementById('lord-preview');
const levelInput = document.getElementById('lord-level');
const levelValue = document.getElementById('lord-level-value');
const extraInput = document.getElementById('lord-extra');

const lordIds = Object.keys(lordData.lords);
const maxLevel = lordData.max_level;

let lordId = lordIds[0];
// The build per lord: switching lords keeps the other one's build (only the shown one is in the URL).
const builds = Object.fromEntries(lordIds.map((id) => [id, emptyBuild(lordData.lords[id])]));
// The talents of later seasons (above max_level) are shown: a preview, they can't take points.
let preview = false;
// The talent in the detail panel (its index in the build): the one last hovered, focused or tapped.
let shown = null;
let note = '';
let noteTimer = null;
// A touch on a talent: where it started and the long-press timer; `longPressed` swallows the click that follows.
let press = null;
let longPressed = false;

const lord = () => lordData.lords[lordId];
const build = () => builds[lordId];

function clampInt(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

/** What this browser saved: `{ level, extra, lord, builds: { <lord>: <build as URL text> } }` (or less). */
function loadSaved() {
    try {
        return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        // No storage, or nothing valid in it: the defaults.
        return {};
    }
}

const saved = loadSaved();
// The player's Specialty level (the season's highest at first) and extra points.
const setup = {
    level: clampInt(saved.level, 1, maxLevel, maxLevel),
    extra: clampInt(saved.extra, 0, MAX_EXTRA, 0),
};

/** Saves the player's level and extra points, the lord and every lord's build. */
function save() {
    const encoded = Object.fromEntries(lordIds.map((id) => [id, encodeBuild(builds[id])]));
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...setup, lord: lordId, builds: encoded }));
    } catch {
        // Not saved (private browsing, ...): the page still works.
    }
}

/** The saved lord and builds, then the URL's: a link (with `lord`) shows its lord and build. */
function readState() {
    if (lordIds.includes(saved.lord)) {
        lordId = saved.lord;
    }
    lordIds.forEach((id) => {
        builds[id] = decodeBuild(lordData.lords[id], saved.builds?.[id], maxLevel);
    });
    const params = new URLSearchParams(window.location.search);
    if (lordIds.includes(params.get('lord'))) {
        lordId = params.get('lord');
        builds[lordId] = decodeBuild(lord(), params.get('t'), maxLevel);
    }
}

/** A change to the lord or the build: into the URL and saved. */
function commit() {
    writeUrl();
    save();
}

function writeUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('lord', lordId);
    const encoded = encodeBuild(build());
    if (encoded) {
        url.searchParams.set('t', encoded);
    } else {
        url.searchParams.delete('t');
    }
    window.history.replaceState(null, '', `${url.pathname}?${url.searchParams}${url.hash}`);
}

/** A cooldown in hours as the game's days, hours and minutes ("1d 23h 30m"). */
function formatCooldown(hours) {
    const minutes = Math.round(hours * 60);
    const parts = [
        [Math.floor(minutes / 1440), 'd'],
        [Math.floor((minutes % 1440) / 60), 'h'],
        [minutes % 60, 'm'],
    ];
    return parts
        .filter(([amount]) => amount > 0)
        .map(([amount, unit]) => `${amount}${unit}`)
        .join(' ');
}

/** The talent's text with its value at `points` in place of "{value}" (markup). */
function effectHtml(talent, points) {
    const value = talentValue(talent, points);
    const text = escapeHtml(localizedName(talent.description));
    return value === null ? text : text.replace('{value}', `<strong>${formatThousands(value)}</strong>`);
}

function showNote(text) {
    note = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
        note = '';
        renderBar();
    }, NOTE_MS);
    renderBar();
}

/**
 * One point more (`delta` 1) or less (-1) on talent `index`. A click on a maxed talent, or one the player's level
 * doesn't unlock, does nothing; one on a talent of a later season says why. Points can always be removed (also from
 * talents the level no longer unlocks after lowering it).
 */
function changePoints(index, delta) {
    shown = index;
    const reason = delta > 0 ? raiseBlock(lord(), build(), index, setup.level, maxLevel) : null;
    if (reason === 'outOfSeason') {
        showNote(t('lord.blocked.outOfSeason', { name: localizedName(lord().talents[index].name) }));
    } else if (!reason) {
        builds[lordId] = changeTalent(lord(), build(), index, delta);
        commit();
        renderBar();
    }
    renderTree();
    renderDetail();
}

function showTalent(index) {
    if (index !== shown) {
        shown = index;
        renderDetail();
    }
}

function renderControls() {
    controls.innerHTML = lordIds
        .map(
            (id) =>
                `<button type="button" class="lord-switch__button${id === lordId ? ' is-active' : ''}" data-lord="${id}" aria-pressed="${id === lordId}">${escapeHtml(localizedName(lordData.lords[id].name))}</button>`,
        )
        .join('');
    controls.setAttribute('aria-label', t('lord.lords'));
    intro.textContent = localizedName(lord().description);
}

/** A talent's icon in a hexagon (active) or a rounded square (passive), with its points below it. */
function tileHtml(talent, points = null) {
    const count =
        points === null
            ? ''
            : `<span class="lord-talent__count">${escapeHtml(t('lord.count', { points, max: talent.max_level }))}</span>`;
    return `<span class="lord-talent__frame"><img src="${ICONS}${talent.icon}" alt="" draggable="false" /></span>${count}`;
}

/**
 * A talent the player's level doesn't unlock is grey and takes no points. One that has points anyway (the level was
 * lowered after) keeps them, with a red count: the build stays as it was when the level goes back up.
 */
function talentClasses(talent, points) {
    const locked = isLocked(talent, setup.level, maxLevel);
    return [
        'lord-talent',
        `lord-talent--${talent.kind}`,
        locked ? 'is-locked' : '',
        locked && points > 0 ? 'is-over' : '',
        points > 0 ? 'has-points' : '',
        points >= talent.max_level ? 'is-max' : '',
    ].filter(Boolean);
}

function talentHtml({ talent, index }, current) {
    const points = current[index];
    const classes = talentClasses(talent, points);
    const label = t('lord.talentLabel', { name: localizedName(talent.name), points, max: talent.max_level });
    const disabled = classes.includes('is-locked') ? ' aria-disabled="true"' : '';
    return `<button type="button" class="${classes.join(' ')}" data-index="${index}" aria-label="${escapeHtml(label)}"${disabled}>${tileHtml(talent, points)}</button>`;
}

function renderTree() {
    const current = build();
    // As in the game: the highest level on top, Lv.1 at the bottom, lit up to the player's level.
    const rows = talentRows(lord())
        .filter((row) => preview || row.level <= maxLevel)
        .reverse();
    const rowsHtml = rows
        .map((row) => {
            const [left, ...right] = row.talents;
            const reached = row.level <= setup.level;
            const badgeTitle = row.level > maxLevel ? t('lord.outOfSeason') : t('lord.unlocksAt', { level: row.level });
            return `
                <div class="lord-row${reached ? ' is-reached' : ''}">
                    <div class="lord-row__side lord-row__side--left">${talentHtml(left, current)}<span class="lord-row__link"></span></div>
                    <div class="lord-row__spine"><span class="lord-row__badge" data-level="${row.level}" title="${escapeHtml(badgeTitle)}">${row.level}</span></div>
                    <div class="lord-row__side lord-row__side--right">${right.length ? '<span class="lord-row__link"></span>' : ''}${right.map((entry) => talentHtml(entry, current)).join('')}</div>
                </div>`;
        })
        .join('');
    tree.innerHTML = `
        <div class="lord-tree__inner">
            <div class="lord-spine"><div class="lord-spine__lit"></div></div>
            ${rowsHtml}
        </div>`;
    placeSpine();
}

/**
 * The spine from the top badge to the bottom one, lit from the bottom up to the player's level: between two badges
 * in proportion (Lv.17 lights 2/5 of the way from 15 to 20). Measured from the badges, so it fits every layout.
 */
function placeSpine() {
    const inner = tree.querySelector('.lord-tree__inner');
    const badges = [...inner.querySelectorAll('.lord-row__badge')].map((badge) => {
        const box = badge.getBoundingClientRect();
        return { level: Number(badge.dataset.level), y: box.top + box.height / 2 };
    });
    if (badges.length === 0) {
        return;
    }
    const top = inner.getBoundingClientRect().top;
    // Badges top down: the highest level first.
    const [highest] = badges;
    const lowest = badges[badges.length - 1];
    let litY = lowest.y;
    for (let i = badges.length - 1; i > 0; i--) {
        const below = badges[i];
        const above = badges[i - 1];
        if (setup.level >= above.level) {
            litY = above.y;
        } else if (setup.level > below.level) {
            litY = below.y + ((above.y - below.y) * (setup.level - below.level)) / (above.level - below.level);
            break;
        } else {
            break;
        }
    }
    const spine = inner.querySelector('.lord-spine');
    spine.style.top = `${highest.y - top}px`;
    spine.style.height = `${lowest.y - highest.y}px`;
    spine.querySelector('.lord-spine__lit').style.height = `${lowest.y - litY}px`;
}

function renderDetail() {
    const talent = shown === null ? null : lord().talents[shown];
    if (!talent) {
        detail.innerHTML = `<p class="lord-detail__hint">${escapeHtml(t('lord.pickHint'))}</p>`;
        return;
    }
    const points = build()[shown];
    const facts = [
        t(talent.kind === 'active' ? 'lord.active' : 'lord.passive'),
        talent.cooldown_hours ? t('lord.cooldown', { time: formatCooldown(talent.cooldown_hours) }) : null,
        isOutOfSeason(talent, maxLevel) ? t('lord.outOfSeason') : t('lord.unlocksAt', { level: talent.unlock_level }),
    ].filter(Boolean);
    const effects = talent.values
        ? `
            <p><span class="lord-detail__label">${escapeHtml(t('lord.now'))}</span> ${points > 0 ? effectHtml(talent, points) : `<span class="text-dim">${escapeHtml(t('lord.notTaken'))}</span>`}</p>
            <p><span class="lord-detail__label">${escapeHtml(t('lord.next'))}</span> ${points < talent.max_level ? effectHtml(talent, points + 1) : `<span class="text-dim">${escapeHtml(t('lord.maxReached'))}</span>`}</p>
            <ol class="lord-detail__values" aria-label="${escapeHtml(t('lord.values'))}">
                ${talent.values
                    .map(
                        (value, i) =>
                            `<li class="${i + 1 === points ? 'is-current' : ''}"><span class="text-dim">${escapeHtml(t('lord.valueLevel', { level: i + 1 }))}</span> ${formatThousands(value)}</li>`,
                    )
                    .join('')}
            </ol>`
        : `<p>${effectHtml(talent, points)}</p>`;
    detail.innerHTML = `
        <div class="lord-detail__head">
            <span class="${talentClasses(talent, points).join(' ')}">${tileHtml(talent)}</span>
            <div>
                <h3>${escapeHtml(localizedName(talent.name))}</h3>
                <p class="lord-detail__facts">${facts.map(escapeHtml).join(' · ')}</p>
            </div>
        </div>
        <p class="lord-detail__level">${escapeHtml(t('lord.talentLevel', { points, max: talent.max_level }))}</p>
        ${effects}`;
}

/** "Requires Legion Commander Lv 31" (plus the skill book points only when the levels aren't enough). */
/** "Legion Commander: Lv.31": the level the build uses (Lv.0 while it's empty). */
function requiresHtml({ level }) {
    return tHtml('lord.requires', {
        lord: escapeHtml(localizedName(lord().name)),
        level: `<strong>${escapeHtml(t('lord.levelValue', { level }))}</strong>`,
    });
}

function renderBar() {
    const needs = requirements(lord(), build(), maxLevel);
    const left = pointsLeft(build(), setup);
    // Red when the player can't have the build yet: their level is too low, or their points don't pay for it.
    const reachable = isReachable(lord(), build(), setup);
    // As in the game: the lord and level, the points with a reset icon next to them; Copy link on the right in every
    // language (the text wraps, the button stays).
    const reset = escapeHtml(t('common.reset'));
    bar.innerHTML = `
        <div class="lord-bar__summary">
            <span class="${reachable ? '' : 'text-bad'}">${requiresHtml(needs)}</span>
            <span class="lord-bar__points-group">
                <span class="${left < 0 ? 'text-bad' : 'lord-bar__points'}">${tHtml('lord.left', { left: `<strong>${left}</strong>` })}</span>
                <button type="button" class="lord-bar__reset btn-secondary" data-action="reset" title="${reset}" aria-label="${reset}" ${needs.spent > 0 ? '' : 'disabled'}>↺</button>
            </span>
            <span class="lord-bar__note" role="status">${escapeHtml(note)}</span>
        </div>
        <button type="button" class="lord-bar__copy" data-action="copy">${escapeHtml(t('lord.copyLink'))}</button>`;
}

/** The level next to its slider ("Lv.40"). */
function renderLevel() {
    levelValue.textContent = t('lord.levelValue', { level: setup.level });
}

function renderAll() {
    renderControls();
    renderLevel();
    renderTree();
    renderDetail();
    renderBar();
}

/** The tree starts at its bottom (Lv 1), as in the game. */
window.addEventListener('resize', () => {
    if (tree.firstElementChild) {
        placeSpine();
    }
});

function scrollTreeToBottom() {
    tree.scrollTop = tree.scrollHeight;
}

function cancelPress() {
    clearTimeout(press?.timer);
    press = null;
}

function wireEvents() {
    controls.addEventListener('click', (event) => {
        const button = event.target.closest('[data-lord]');
        if (button && button.dataset.lord !== lordId) {
            lordId = button.dataset.lord;
            shown = null;
            commit();
            renderAll();
            scrollTreeToBottom();
        }
    });

    const setupInputs = [
        [levelInput, 'level', 1, maxLevel],
        [extraInput, 'extra', 0, MAX_EXTRA],
    ];
    setupInputs.forEach(([input, key, min, max]) => {
        input.addEventListener('input', () => {
            // While typing: only a valid number counts (an empty field keeps the last one).
            setup[key] = clampInt(input.value, min, max, setup[key]);
            save();
            renderLevel();
            // The level locks and unlocks talents.
            renderTree();
            renderDetail();
            renderBar();
        });
        input.addEventListener('change', () => {
            input.value = setup[key];
        });
    });

    previewSwitch.addEventListener('change', () => {
        preview = previewSwitch.checked;
        // A talent of a later season leaves the details with the preview.
        if (!preview && shown !== null && isOutOfSeason(lord().talents[shown], maxLevel)) {
            shown = null;
            renderDetail();
        }
        const fromBottom = tree.scrollHeight - tree.scrollTop;
        renderTree();
        // The new rows are on top: keep the view where it was.
        tree.scrollTop = tree.scrollHeight - fromBottom;
    });

    const talentOf = (event) => event.target.closest('.lord-talent[data-index]');
    const indexOf = (button) => Number(button.dataset.index);
    const focusTalent = (index) => tree.querySelector(`[data-index="${index}"]`)?.focus({ preventScroll: true });

    // Hover and keyboard focus show a talent; nothing hides it again, so the panel keeps the last one.
    tree.addEventListener('pointerover', (event) => {
        const button = talentOf(event);
        if (button && event.pointerType === 'mouse') {
            showTalent(indexOf(button));
        }
    });
    tree.addEventListener('focusin', (event) => {
        const button = talentOf(event);
        if (button) {
            showTalent(indexOf(button));
        }
    });

    // Phones: a long press removes a point; moving the finger (scrolling) or lifting it early cancels it.
    tree.addEventListener('pointerdown', (event) => {
        const button = talentOf(event);
        cancelPress();
        longPressed = false;
        if (!button || event.pointerType !== 'touch') {
            return;
        }
        const index = indexOf(button);
        press = {
            x: event.clientX,
            y: event.clientY,
            timer: setTimeout(() => {
                press = null;
                longPressed = true;
                changePoints(index, -1);
            }, LONG_PRESS_MS),
        };
    });
    tree.addEventListener('pointermove', (event) => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > TOUCH_SLOP_PX) {
            cancelPress();
        }
    });
    ['pointerup', 'pointercancel'].forEach((type) => tree.addEventListener(type, cancelPress));

    tree.addEventListener('click', (event) => {
        const button = talentOf(event);
        if (!button) {
            return;
        }
        if (longPressed) {
            longPressed = false;
            return;
        }
        const index = indexOf(button);
        changePoints(index, 1);
        // The re-drawn tree lost the focus: back on the talent for the keyboard (Enter, Space), not after a mouse click.
        if (event.detail === 0) {
            focusTalent(index);
        }
    });
    tree.addEventListener('contextmenu', (event) => {
        const button = talentOf(event);
        if (!button) {
            return;
        }
        // No browser menu; a long press on a phone opens it too, and removes its point via the timer above.
        event.preventDefault();
        if (event.pointerType !== 'touch' && !longPressed && !press) {
            changePoints(indexOf(button), -1);
        }
    });
    tree.addEventListener('keydown', (event) => {
        const button = talentOf(event);
        if (button && (event.key === 'Delete' || event.key === 'Backspace')) {
            event.preventDefault();
            const index = indexOf(button);
            changePoints(index, -1);
            focusTalent(index);
        }
    });

    bar.addEventListener('click', async (event) => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'reset') {
            builds[lordId] = emptyBuild(lord());
            commit();
            renderTree();
            renderDetail();
            renderBar();
        } else if (action === 'copy') {
            try {
                await navigator.clipboard.writeText(window.location.href);
                showNote(t('lord.copied'));
            } catch {
                showNote(t('lord.copyFailed'));
            }
        }
    });
}

function init() {
    readState();
    writeUrl();
    levelInput.max = maxLevel;
    levelInput.value = setup.level;
    extraInput.max = MAX_EXTRA;
    extraInput.value = setup.extra;
    wireEvents();
    renderAll();
    scrollTreeToBottom();
}

startPage('lord-specialty', { init, onLocaleChange: renderAll, withData: false });

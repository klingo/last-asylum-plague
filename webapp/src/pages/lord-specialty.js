/**
 * Lord Specialty: a planner for the two lords' talents (specialty skills, `data/lord_specialty.json`), drawn like the
 * game's tree: a spine from Lv.1 at the bottom up, with a badge per unlock level and that level's two talents left
 * and right of it (hexagons are active talents, squares passive ones). Left click adds a point, right click removes
 * one; hovering a talent shows what it does. On a phone (no hover) a tap adds a point and shows the talent, a long
 * press removes one.
 *
 * The next season's switch (Season 02: Frozen Era) raises the Specialty level to its highest, shows and enables the
 * lords' talents up to it (Lv.41 to 60) and adds a tab with the season's own talents (`next_season`). Those points
 * aren't the player's Specialty points (how the game counts them isn't known yet), so that tab's bar only says what
 * the build spends and which level it needs. A talent may require another at its max level (Super Frenzy needs
 * Frenzy): it stays grey until then.
 *
 * The bar says what the build requires (the lord's level, and extra points only once the season's levels don't give
 * enough) and how many of the player's points are left: their Specialty level and extra Specialty Skill Points,
 * entered above the tree. The rules live in core/lord-specialty.js.
 *
 * The tab and the build are in the URL, so a link shares the build. This browser saves the player's level and extra
 * points, the season switch, the tab and every tab's build: the page without a link opens them again. A shared link
 * shows its build (and turns the season on if it needs it), saved (over the player's own) only once they change
 * something.
 */
import { startPage } from '../ui/page.js';
import '../styles/pages/lord.css';
import { STORAGE_KEYS, readJson, writeJson } from '../ui/storage.js';
import { setUrlParams, urlParam } from '../ui/url.js';
import { localizedName, t, tHtml } from '../ui/i18n.js';
import { escapeHtml } from '../ui/html.js';
import { formatThousands } from '../ui/format.js';
import { PLACEHOLDER_ICON } from '../ui/images.js';
import lordData from '../../../data/lord_specialty.json';
import {
    changeTalent,
    decodeBuild,
    emptyBuild,
    encodeBuild,
    isLocked,
    isReachable,
    pointsLeft,
    raiseBlock,
    requirementsMet,
    requirements,
    talentRows,
    talentValue,
    unmetRequirement,
} from '../core/lord-specialty.js';
import { BASE_URL } from '../ui/base-url.js';

const ICONS = `${BASE_URL}assets/lord/`;
// How long the bar shows a note ("Link copied", why a click changed nothing).
const NOTE_MS = 3000;
// A touch held this long removes a point (phones have no right click).
const LONG_PRESS_MS = 500;
// A touch that moves further is a scroll, not a press.
const TOUCH_SLOP_PX = 10;
// Highest extra points the input takes.
const MAX_EXTRA = 999;

const controls = document.getElementById('lord-controls');
const intro = document.getElementById('lord-intro');
const tree = document.getElementById('lord-tree');
const detail = document.getElementById('lord-detail');
const bar = document.getElementById('lord-bar');
const seasonSwitch = document.getElementById('lord-season');
const seasonLabel = document.getElementById('lord-season-label');
const levelInput = document.getElementById('lord-level');
const levelValue = document.getElementById('lord-level-value');
const extraInput = document.getElementById('lord-extra');

// The lords' trees, then the next season's own (a tab only while its switch is on).
const season = lordData.next_season;
const seasonId = season?.id;
const trees = { ...lordData.lords, ...(season ? { [seasonId]: season } : {}) };
const treeIds = Object.keys(trees);

/** What this browser saved: `{ level, extra, season2, lord, builds: { <tree>: <build as URL text> } }` (or less). */
function loadSaved() {
    return readJson(STORAGE_KEYS.lordSetup);
}

const saved = loadSaved();
// The next season's switch: its talents are shown and enabled, the Specialty level goes up to its highest.
let frozen = Boolean(season) && saved.season2 === true;

/** The highest Specialty level of the active season. */
const seasonMax = () => (frozen ? season.max_level : lordData.max_level);
/** The highest level the tree's talents have: the season's own tree keeps its builds (and Lv.55/60) while the switch is off. */
const treeMax = (id) => (id === seasonId ? season.max_level : seasonMax());

let treeId = treeIds[0];
// The build per tree: switching tabs keeps the other ones' builds (only the shown one is in the URL).
const builds = Object.fromEntries(treeIds.map((id) => [id, emptyBuild(trees[id])]));
// The talent in the detail panel (its index in the build): the one last hovered, focused or tapped.
let shown = null;
let note = '';
let noteTimer = null;
// A touch on a talent: where it started and the long-press timer; `longPressed` swallows the click that follows.
let press = null;
let longPressed = false;

const currentTree = () => trees[treeId];
const build = () => builds[treeId];

function clampInt(value, min, max, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

// The player's Specialty level (the season's highest at first) and extra points.
const setup = {
    level: clampInt(saved.level, 1, seasonMax(), seasonMax()),
    extra: clampInt(saved.extra, 0, MAX_EXTRA, 0),
};

/** Saves the player's level and extra points, the season switch, the tab and every tab's build. */
function save() {
    const encoded = Object.fromEntries(treeIds.map((id) => [id, encodeBuild(builds[id])]));
    writeJson(STORAGE_KEYS.lordSetup, { ...setup, season2: frozen, lord: treeId, builds: encoded });
}

/**
 * The saved tab and builds, then the URL's: a link (with `lord`) shows its tab and build, and turns the next season
 * on when the tab is the season's or the build has points in talents of its levels.
 */
function readState() {
    treeIds.forEach((id) => {
        builds[id] = decodeBuild(trees[id], saved.builds?.[id], treeMax(id));
    });
    if (treeIds.includes(saved.lord) && (frozen || saved.lord !== seasonId)) {
        treeId = saved.lord;
    }
    const linked = urlParam('lord');
    if (treeIds.includes(linked)) {
        treeId = linked;
        const asked = decodeBuild(trees[linked], urlParam('t'), season ? season.max_level : lordData.max_level);
        const needsSeason =
            linked === seasonId ||
            asked.some((points, i) => points > 0 && trees[linked].talents[i].unlock_level > lordData.max_level);
        frozen = Boolean(season) && (frozen || needsSeason);
        builds[linked] = decodeBuild(trees[linked], urlParam('t'), treeMax(linked));
    }
}

/** A change to the tab or the build: into the URL and saved. */
function commit() {
    writeUrl();
    save();
}

function writeUrl() {
    setUrlParams({ lord: treeId, t: encodeBuild(build()) });
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
 * doesn't unlock, does nothing; one on a talent whose required talent isn't maxed says why. Points can always be
 * removed (also from talents the level no longer unlocks after lowering it).
 */
function changePoints(index, delta) {
    shown = index;
    const reason = delta > 0 ? raiseBlock(currentTree(), build(), index, setup.level, seasonMax()) : null;
    if (reason === 'requires') {
        const talents = currentTree().talents;
        showNote(
            t('lord.blocked.requires', {
                name: localizedName(talents[index].name),
                required: localizedName(talents[unmetRequirement(currentTree(), build(), index)].name),
            }),
        );
    } else if (!reason) {
        builds[treeId] = changeTalent(currentTree(), build(), index, delta);
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

/** The tabs: the lords, and the next season's own tree while its switch is on. */
function renderControls() {
    controls.innerHTML = treeIds
        .filter((id) => frozen || id !== seasonId)
        .map(
            (id) =>
                `<button type="button" class="lord-switch__button${id === treeId ? ' is-active' : ''}" data-lord="${id}" aria-pressed="${id === treeId}">${escapeHtml(localizedName(trees[id].name))}</button>`,
        )
        .join('');
    controls.setAttribute('aria-label', t('lord.lords'));
    intro.textContent = localizedName(currentTree().description);
    seasonSwitch.checked = frozen;
    seasonSwitch.closest('label').hidden = !season;
    seasonLabel.textContent = season ? localizedName(season.name) : '';
}

/** A talent's icon in a hexagon (active) or a rounded square (passive), with its points below it. */
function tileHtml(talent, points = null) {
    const count =
        points === null
            ? ''
            : `<span class="lord-talent__count">${tHtml('lord.count', { points, max: talent.max_level })}</span>`;
    const src = talent.icon ? `${ICONS}${talent.icon}` : PLACEHOLDER_ICON;
    return `<span class="lord-talent__frame"><img src="${src}" alt="" draggable="false" /></span>${count}`;
}

/**
 * A talent the player's level doesn't unlock, or whose required talent isn't maxed, is grey and takes no points. One
 * that has points anyway (the level or the required talent was lowered after) keeps them, with a red count: the
 * build stays as it was when it goes back up.
 */
function talentClasses(index, points) {
    const talent = currentTree().talents[index];
    const locked =
        isLocked(talent, setup.level, seasonMax()) || unmetRequirement(currentTree(), build(), index) !== null;
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
    const classes = talentClasses(index, points);
    const label = t('lord.talentLabel', { name: localizedName(talent.name), points, max: talent.max_level });
    const disabled = classes.includes('is-locked') ? ' aria-disabled="true"' : '';
    return `<button type="button" class="${classes.join(' ')}" data-index="${index}" aria-label="${escapeHtml(label)}"${disabled}>${tileHtml(talent, points)}</button>`;
}

function renderTree() {
    const current = build();
    // As in the game: the highest level on top, Lv.1 at the bottom, lit up to the player's level.
    const rows = talentRows(currentTree())
        .filter((row) => row.level <= seasonMax())
        .reverse();
    const rowsHtml = rows
        .map((row) => {
            const [left, ...right] = row.talents;
            const reached = row.level <= setup.level;
            const badgeTitle = t('lord.unlocksAt', { level: row.level });
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
    const talent = shown === null ? null : currentTree().talents[shown];
    if (!talent) {
        detail.innerHTML = `<p class="lord-detail__hint">${tHtml('lord.pickHint')}</p>`;
        return;
    }
    const points = build()[shown];
    const facts = [
        t(talent.kind === 'active' ? 'lord.active' : 'lord.passive'),
        talent.cooldown_hours ? t('lord.cooldown', { time: formatCooldown(talent.cooldown_hours) }) : null,
        t('lord.unlocksAt', { level: talent.unlock_level }),
        talent.requires
            ? t('lord.requiresTalent', {
                  name: localizedName(currentTree().talents.find((other) => other.id === talent.requires).name),
              })
            : null,
    ].filter(Boolean);
    const effects = talent.values
        ? `
            <p><span class="lord-detail__label">${tHtml('lord.now')}</span> ${points > 0 ? effectHtml(talent, points) : `<span class="text-dim">${tHtml('lord.notTaken')}</span>`}</p>
            <p><span class="lord-detail__label">${tHtml('lord.next')}</span> ${points < talent.max_level ? effectHtml(talent, points + 1) : `<span class="text-dim">${tHtml('lord.maxReached')}</span>`}</p>
            <ol class="lord-detail__values" aria-label="${tHtml('lord.values')}">
                ${talent.values
                    .map(
                        (value, i) =>
                            `<li class="${i + 1 === points ? 'is-current' : ''}"><span class="text-dim">${tHtml('lord.valueLevel', { level: i + 1 })}</span> ${formatThousands(value)}</li>`,
                    )
                    .join('')}
            </ol>`
        : `<p>${effectHtml(talent, points)}</p>`;
    detail.innerHTML = `
        <div class="lord-detail__head">
            <span class="${talentClasses(shown, points).join(' ')}">${tileHtml(talent)}</span>
            <div>
                <h3>${escapeHtml(localizedName(talent.name))}</h3>
                <p class="lord-detail__facts">${facts.map(escapeHtml).join(' · ')}</p>
            </div>
        </div>
        <p class="lord-detail__level">${tHtml('lord.talentLevel', { points, max: talent.max_level })}</p>
        ${effects}`;
}

/** "Legion Commander: Lv.31": the level the build uses (Lv.0 while it's empty). */
function requiresHtml(level) {
    return tHtml('lord.requires', {
        lord: escapeHtml(localizedName(currentTree().name)),
        level: `<strong>${tHtml('lord.levelValue', { level })}</strong>`,
    });
}

function renderBar() {
    const needs = requirements(currentTree(), build(), seasonMax());
    // The season's own talents don't use the player's points (not known yet how the game counts them): the bar says
    // what the build spends and needs, and the player's level and the requirements decide whether they can have it.
    const own = treeId === seasonId;
    const left = pointsLeft(build(), setup);
    // Red when the player can't have the build yet: their level is too low, or their points don't pay for it.
    const reachable = own
        ? needs.unlockLevel <= setup.level && requirementsMet(currentTree(), build())
        : isReachable(currentTree(), build(), setup);
    // As in the game: the lord and level, the points with a reset icon next to them; Copy link on the right in every
    // language (the text wraps, the button stays).
    const reset = tHtml('common.reset');
    const points = own
        ? `<span class="lord-bar__points">${tHtml('lord.spent', { spent: `<strong>${needs.spent}</strong>` })}</span>`
        : `<span class="${left < 0 ? 'text-bad' : 'lord-bar__points'}">${tHtml('lord.left', { left: `<strong>${left}</strong>` })}</span>`;
    bar.innerHTML = `
        <div class="lord-bar__summary">
            <span class="${reachable ? '' : 'text-bad'}">${requiresHtml(own ? needs.unlockLevel : needs.level)}</span>
            <span class="lord-bar__points-group">
                ${points}
                <button type="button" class="lord-bar__reset btn-secondary" data-action="reset" title="${reset}" aria-label="${reset}" ${needs.spent > 0 ? '' : 'disabled'}>↺</button>
            </span>
            <span class="lord-bar__note" role="status">${escapeHtml(note)}</span>
        </div>
        <button type="button" class="lord-bar__copy" data-action="copy">${tHtml('lord.copyLink')}</button>`;
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

/**
 * Side by side, the tree takes the viewport height the rest of the page leaves (the detail card's height at least), so
 * the page itself doesn't scroll while the tree can shrink, down to one row. Stacked (phones) the CSS fallback applies.
 */
const sideBySide = window.matchMedia('(min-width: 961px)');

function fitTree() {
    if (!sideBySide.matches) {
        tree.style.removeProperty('--lord-tree-max');
        return;
    }
    const layout = tree.closest('.lord-layout');
    const boardExtra = tree.parentElement.offsetHeight - tree.offsetHeight;
    const available = document.documentElement.clientHeight - (document.body.offsetHeight - layout.offsetHeight);
    const row = tree.querySelector('.lord-row');
    const oneRow = row ? row.offsetHeight + 12 : 100;
    const max = `${Math.max(oneRow, Math.floor(Math.max(available, detail.offsetHeight) - boardExtra))}px`;
    if (tree.style.getPropertyValue('--lord-tree-max') === max) {
        return;
    }
    // Keep the distance of the shown part to the tree's bottom, which is where it starts.
    const fromBottom = tree.scrollHeight - tree.scrollTop - tree.clientHeight;
    tree.style.setProperty('--lord-tree-max', max);
    tree.scrollTop = tree.scrollHeight - tree.clientHeight - fromBottom;
}

/**
 * Turns the next season on or off. On: the lords' talents up to its highest level take points, its own tab appears.
 * Off: the level and the lords' builds go back to the current season's (the points above are dropped), the tab goes
 * (its build stays saved).
 */
function setSeason(on) {
    frozen = on;
    levelInput.max = seasonMax();
    if (!on) {
        setup.level = Math.min(setup.level, seasonMax());
        levelInput.value = setup.level;
        treeIds
            .filter((id) => id !== seasonId)
            .forEach((id) => {
                builds[id] = decodeBuild(trees[id], encodeBuild(builds[id]), seasonMax());
            });
        if (treeId === seasonId) {
            treeId = treeIds[0];
        }
    }
    shown = null;
    commit();
    // The rows come and go on top: keep the view where it was.
    const fromBottom = tree.scrollHeight - tree.scrollTop;
    renderAll();
    tree.scrollTop = tree.scrollHeight - fromBottom;
}

function cancelPress() {
    clearTimeout(press?.timer);
    press = null;
}

function wireEvents() {
    controls.addEventListener('click', (event) => {
        const button = event.target.closest('[data-lord]');
        if (button && button.dataset.lord !== treeId) {
            treeId = button.dataset.lord;
            shown = null;
            commit();
            renderAll();
            scrollTreeToBottom();
        }
    });

    const setupInputs = [
        [levelInput, 'level', 1, seasonMax],
        [extraInput, 'extra', 0, () => MAX_EXTRA],
    ];
    setupInputs.forEach(([input, key, min, max]) => {
        input.addEventListener('input', () => {
            // While typing: only a valid number counts (an empty field keeps the last one).
            setup[key] = clampInt(input.value, min, max(), setup[key]);
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

    seasonSwitch.addEventListener('change', () => setSeason(seasonSwitch.checked));

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
            builds[treeId] = emptyBuild(currentTree());
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
    levelInput.max = seasonMax();
    levelInput.value = setup.level;
    extraInput.max = MAX_EXTRA;
    extraInput.value = setup.extra;
    wireEvents();
    renderAll();
    fitTree();
    scrollTreeToBottom();
    // The page's height changes with the window, the open "How it works" and the detail card.
    const observer = new ResizeObserver(fitTree);
    observer.observe(document.body);
    observer.observe(detail);
    window.addEventListener('resize', fitTree);
}

startPage('lord-specialty', { init, onLocaleChange: renderAll, withData: false });

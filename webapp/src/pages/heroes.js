/**
 * My Heroes: what the player has of every hero, per faction (the heroes as the squad stands). Five icons show a hero's
 * stars, yellow up to 5 stars and red from 6 on (core/hero-stars.js), set with a slider under them in whole stars from 0 to 10.
 * A hero with an exclusive weapon (`weapon` in data/hero_skills.json) shows it below, with its own stars the same way.
 * An awakenable hero (`awakenable`) has an awakening level too, which gives its skill cap and the frame of its
 * portrait: as in the game, the level in big orange, the milestones (the skills the frame levels unlock, `awakening_skills`
 * in data/hero_skills.json, else the hero's portrait; greyed with a padlock until reached; a click jumps there) above a
 * slider from 0 to the highest, locked until the hero has 10 stars.
 * The Skill Upgrade Path reads all of it. Saved in this browser (and synced) as
 * `{ faction, heroes: { <hero id>: { stars, weapon, awakening } } }`. While a slider moves, the page follows it, but
 * what it says is written (and so synced) when the slider is let go, or a second after its last change (keyboard).
 */
import { startPage } from '../ui/page.js';
import '../styles/pages/heroes.css';
import skillData from '../../../data/hero_skills.json';
import { STORAGE_KEYS, readJson, writeJson } from '../ui/storage.js';
import { localizedName, t, tHtml } from '../ui/i18n.js';
import { escapeAttr, escapeHtml } from '../ui/html.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import {
    FACTIONS,
    heroHeadHtml,
    heroImage,
    heroName,
    lockImage,
    renderFactionSwitch,
    skillImage,
    squadHeroes,
    starImage,
    weaponImage,
} from '../ui/hero-parts.js';
import {
    AWAKENING_FRAMES,
    AWAKENING_MIN_STARS,
    MAX_STARS,
    MAX_WEAPON_STARS,
    awakeningFrame,
    clampLevel,
    hasAwakenedPortrait,
    heroLevel,
    starIcons,
} from '../core/hero-stars.js';
import { awakeningSkills, skillCap } from '../core/skill-path.js';

const factionSwitch = document.getElementById('heroes-factions');
const list = document.getElementById('heroes-list');
const help = document.getElementById('heroes-help');

// The levels of a hero in the saved entry, with their highest value (the awakening's is the last of `awakening_caps`).
const MAX = { stars: MAX_STARS, weapon: MAX_WEAPON_STARS, awakening: skillData.awakening_caps.at(-1).level };

// How long after its last change a slider's value is written when the keyboard moves it (a drag writes when let go).
const WRITE_DELAY_MS = 1000;

let data = null;
let factions = [];
let shownFaction = null;
// What is saved (see the header): always what the sliders say, though not always written yet.
let saved = {};
// Whether `saved` has changes that are not written yet, the timer that writes them, and whether a slider is being dragged.
let unwritten = false;
let writeTimer = null;
let dragging = false;

/** The heroes of a faction as the squad stands. */
const factionHeroes = (faction) =>
    squadHeroes(
        data,
        Object.keys(data.heroes).filter((heroId) => data.heroes[heroId].faction === faction),
        faction,
    );

/** Writes what is saved to the browser (and so to the sync), if there is anything new. */
function write() {
    clearTimeout(writeTimer);
    if (unwritten) {
        unwritten = false;
        writeJson(STORAGE_KEYS.heroStars, saved);
    }
}

/**
 * Takes `change` into what is saved and writes it, and draws the page again unless `rerender` is false (a slider
 * moves on its own). With `later`, it is written when the slider is let go (`write` on pointer up), or here a second
 * after the last change if no slider is being dragged (the keyboard).
 */
function save(change, { rerender = true, later = false } = {}) {
    saved = { ...saved, ...change };
    unwritten = true;
    clearTimeout(writeTimer);
    if (!later) {
        write();
    } else if (!dragging) {
        writeTimer = setTimeout(write, WRITE_DELAY_MS);
    }
    if (rerender) {
        render();
    }
}

/** Sets a hero's `field` ('stars', 'weapon' or 'awakening') to `value`. */
function setLevel(heroId, field, value, options) {
    save(
        {
            heroes: {
                ...saved.heroes,
                [heroId]: { ...saved.heroes?.[heroId], [field]: clampLevel(value, MAX[field]) },
            },
        },
        options,
    );
}

function setFaction(faction) {
    shownFaction = faction;
    save({ faction });
}

const iconsHtml = (stars) =>
    starIcons(stars)
        .map((icon) => `<img src="${starImage(icon)}" alt="" />`)
        .join('');

const countHtml = (stars) => tHtml('heroes.stars', { stars });

/** The marks under a star slider, one per step at the handle's position, longer at 0, 5 (where the yellow stars turn red) and 10. */
const marksHtml = (max) =>
    `<div class="heroes-marks" aria-hidden="true">${Array.from(
        { length: max + 1 },
        (_, stars) =>
            `<span class="heroes-mark${stars % 5 === 0 ? ' heroes-mark--long' : ''}" style="--p: ${stars / max}"></span>`,
    ).join('')}</div>`;

/**
 * The stars of a hero's `field` ('stars' or 'weapon'): the five icons, the count in small yellow under them, and a
 * slider with its marks; `name` (markup-safe) labels the slider. `showStars` keeps them up to date.
 */
function starsHtml(heroId, field, stars, name) {
    const max = MAX[field];
    const label = escapeAttr(t('heroes.starsLabel', { stars, max }));
    return `
        <div class="heroes-rating">
            <span class="heroes-stars__icons" role="img" aria-label="${label}" data-star-icons>${iconsHtml(stars)}</span>
            <div class="heroes-count" data-stars-count>${countHtml(stars)}</div>
            <input type="range" class="heroes-slider" min="0" max="${max}" step="1" value="${stars}" data-hero="${heroId}" data-field="${field}" aria-label="${escapeAttr(t('heroes.starsSlider', { name }))}" />
            ${marksHtml(max)}
        </div>`;
}

/** Shows the stars of a slider (its icons, label and count) without drawing the page again. */
function showStars(slider) {
    const stars = Number(slider.value);
    const rating = slider.closest('.heroes-rating');
    rating.querySelector('[data-star-icons]').innerHTML = iconsHtml(stars);
    rating
        .querySelector('[role="img"]')
        .setAttribute('aria-label', t('heroes.starsLabel', { stars, max: MAX[slider.dataset.field] }));
    rating.querySelector('[data-stars-count]').innerHTML = countHtml(stars);
}

/** A hero's weapon as the game shows it: its name, a card with its picture, and its stars below the card like the hero's. */
function weaponHtml(heroId, weapon, stars) {
    const name = escapeHtml(localizedName(weapon.name));
    return `
        <div class="heroes-section heroes-weapon">
            <strong>${name}</strong>
            <span class="heroes-weapon__card"><img src="${weaponImage(heroId)}" alt="" /></span>
            ${starsHtml(heroId, 'weapon', stars, name)}
        </div>`;
}

const awakeningLevelHtml = (awakening) => tHtml('heroes.awakeningLevel', { level: awakening });
const awakeningLockedHtml = () => tHtml('heroes.awakeningLocked', { stars: AWAKENING_MIN_STARS });

/**
 * The milestones above the awakening slider, one per frame level, at the handle's position for their level: the skill
 * that level unlocks (its title, the level and its description in the tooltip), or the hero's portrait where it isn't
 * known; in colour once reached and greyed with a padlock before. A click sets the awakening to that level. A locked one
 * (`aria-disabled`, not `disabled`, which would stop the tooltip) does nothing. `name` is markup-safe.
 */
function nodesHtml(heroId, awakening, name, locked) {
    const skills = new Map(awakeningSkills(skillData.heroes[heroId]).map((skill) => [skill.level, skill]));
    return `<div class="heroes-nodes">${AWAKENING_FRAMES.map((level) => {
        const skill = skills.get(level);
        const picture = skill ? skillImage(skill.id) : heroImage(data.heroes, heroId);
        // The card: the skill's title (bold, a leading "[Faction Enhance]" in green), the level it unlocks at in red after
        // it while it is not reached (`showAwakening` takes it away and brings it back), a line, and its description.
        const reached = awakening >= level;
        const title = skill ? localizedName(skill.name) : '';
        const note = skill ? t('heroes.awakeningUnlocks', { level }) : '';
        const text = skill ? localizedName(skill.description ?? {}) : '';
        const label =
            escapeAttr(t('heroes.awakeningNode', { name, level })) + escapeHtml(skill ? `. ${title}. ${text}` : '');
        const tooltip = skill
            ? ` data-tooltip-title="${escapeHtml(title)}" data-tooltip-note="${reached ? '' : escapeHtml(note)}" data-locked-note="${escapeHtml(note)}" data-tooltip="${escapeHtml(text)}"`
            : '';
        return `<button type="button" class="heroes-node${reached ? ' is-reached' : ''}" data-hero="${heroId}" data-node="${level}" style="--p: ${level / MAX.awakening}; --node-picture: url('${picture}')"${tooltip} aria-label="${label}" aria-disabled="${locked}"><span class="heroes-node__art"></span><span class="heroes-node__lock"></span><span class="heroes-node__label">${level}</span></button>`;
    }).join('')}</div>`;
}
const skillCapHtml = (awakening) => tHtml('heroes.skillCap', { cap: skillCap(skillData, awakening) });

/**
 * An awakenable hero's awakening: the level, the milestones, a slider for it and the skill cap it gives, or what it takes
 * before it can be awakened (`locked`); `name` (markup-safe) labels the controls. `showAwakening` keeps it up to date.
 */
function awakeningHtml(heroId, awakening, name, locked) {
    return `
        <div class="heroes-section heroes-awakening${locked ? ' is-locked' : ''}" style="--lock: url('${lockImage}')">
            <div class="heroes-awakening__title">${tHtml('heroes.awakening')}</div>
            <div class="heroes-awakening__level" data-awakening-level>${awakeningLevelHtml(awakening)}</div>
            ${nodesHtml(heroId, awakening, name, locked)}
            <input type="range" class="heroes-slider" min="0" max="${MAX.awakening}" step="1" value="${awakening}" style="--p: ${awakening / MAX.awakening}" data-hero="${heroId}" data-field="awakening" aria-label="${escapeAttr(t('heroes.awakeningSlider', { name }))}"${locked ? ' disabled' : ''} />
            <div class="heroes-awakening__cap" data-skill-cap>${locked ? awakeningLockedHtml() : skillCapHtml(awakening)}</div>
        </div>`;
}

/** A hero's portrait (with the frame and picture of its awakening level) and name. */
const headHtml = (heroId, awakening) => heroHeadHtml(data.heroes, heroId, data.heroes[heroId].class, awakening);

/** The look of a portrait at an awakening level: it only changes where the frame or the picture does. */
const portraitLook = (awakening) => `${awakeningFrame(awakening)}/${hasAwakenedPortrait(awakening)}`;

/**
 * Brings the awakening of a hero's card up to date with what is saved, without drawing the page again: the slider (locked
 * below 10 stars), the level, the skill cap, the milestones, and the portrait where its frame or picture changes.
 */
function showAwakening(card) {
    const slider = card.querySelector('.heroes-slider[data-field="awakening"]');
    if (!slider) {
        return;
    }
    const { stars, awakening } = heroLevel(saved, card.dataset.hero);
    const locked = stars < AWAKENING_MIN_STARS;
    slider.disabled = locked;
    slider.value = awakening;
    slider.style.setProperty('--p', awakening / MAX.awakening);
    card.querySelector('.heroes-awakening').classList.toggle('is-locked', locked);
    card.querySelector('[data-awakening-level]').innerHTML = awakeningLevelHtml(awakening);
    card.querySelector('[data-skill-cap]').innerHTML = locked ? awakeningLockedHtml() : skillCapHtml(awakening);
    card.querySelectorAll('.heroes-node').forEach((node) => {
        const reached = awakening >= Number(node.dataset.node);
        node.classList.toggle('is-reached', reached);
        node.dataset.tooltipNote = reached ? '' : (node.dataset.lockedNote ?? '');
        node.setAttribute('aria-disabled', String(locked));
    });
    const look = portraitLook(awakening);
    if (card.dataset.look !== look) {
        card.dataset.look = look;
        card.querySelector('.hero-head').outerHTML = headHtml(card.dataset.hero, awakening);
    }
}

// The divider of the weapon section alone, below the awakening of a hero without a weapon.
const WEAPON_DIVIDER = '<div class="heroes-section heroes-weapon" aria-hidden="true"></div>';

function heroHtml(heroId) {
    const { stars, weapon, awakening } = heroLevel(saved, heroId);
    const name = escapeHtml(heroName(data.heroes, heroId));
    const skills = skillData.heroes[heroId];
    return `
        <div class="heroes-hero" data-hero="${heroId}" data-look="${portraitLook(awakening)}">
            ${headHtml(heroId, awakening)}
            ${starsHtml(heroId, 'stars', stars, name)}
            ${skills?.awakenable ? awakeningHtml(heroId, awakening, name, stars < AWAKENING_MIN_STARS) : ''}
            ${skills?.weapon ? weaponHtml(heroId, skills.weapon, weapon) : skills?.awakenable ? WEAPON_DIVIDER : ''}
        </div>`;
}

function renderHelp() {
    const section = (titleKey, textKey) => `<section><h3>${tHtml(titleKey)}</h3><p>${tHtml(textKey)}</p></section>`;
    help.innerHTML = [
        section('heroes.help.aboutTitle', 'heroes.help.aboutText'),
        section('heroes.help.starsTitle', 'heroes.help.starsText'),
        section('heroes.help.weaponTitle', 'heroes.help.weaponText'),
        `<section><h3>${tHtml('heroes.help.awakeningTitle')}</h3><p>${tHtml('heroes.help.awakeningText', { max: skillData.max_level })}</p></section>`,
        section('heroes.help.savedTitle', 'heroes.help.savedText'),
    ].join('');
}

function render() {
    renderFactionSwitch(factionSwitch, { factions, shown: shownFaction, onPick: setFaction });
    renderHelp();
    list.innerHTML = factionHeroes(shownFaction).map(heroHtml).join('');
    list.style.setProperty('--faction-color', `var(--faction-${shownFaction})`);
    // A click on a milestone jumps there without drawing the page again (a tapped one's tooltip stays on it).
    list.querySelectorAll('.heroes-node').forEach((node) => {
        node.addEventListener('click', () => {
            if (node.getAttribute('aria-disabled') !== 'true') {
                setLevel(node.dataset.hero, 'awakening', Number(node.dataset.node), { rerender: false });
                showAwakening(node.closest('.heroes-hero'));
            }
        });
    });
    enableInfoTooltips(list);
    list.querySelectorAll('.heroes-slider').forEach((slider) => {
        slider.addEventListener('input', () => {
            const { hero, field } = slider.dataset;
            setLevel(hero, field, Number(slider.value), { rerender: false, later: true });
            if (field !== 'awakening') {
                showStars(slider);
            }
            // The stars decide whether the hero can be awakened, the awakening the portrait.
            showAwakening(slider.closest('.heroes-hero'));
        });
    });
}

function init(loaded) {
    data = loaded;
    factions = FACTIONS.filter((faction) => Object.values(data.heroes || {}).some((hero) => hero.faction === faction));
    if (factions.length === 0) {
        document.getElementById('heroes-empty').hidden = false;
        return;
    }
    saved = readJson(STORAGE_KEYS.heroStars);
    shownFaction = factions.includes(saved.faction) ? saved.faction : factions[0];
    // What a slider says is written when it is let go, when it loses the focus, and when the page is left.
    list.addEventListener('pointerdown', (event) => {
        dragging = dragging || Boolean(event.target.closest('.heroes-slider'));
    });
    const letGo = () => {
        dragging = false;
        write();
    };
    window.addEventListener('pointerup', letGo);
    window.addEventListener('pointercancel', letGo);
    list.addEventListener('focusout', write);
    window.addEventListener('pagehide', write);
    render();
}

startPage('heroes', { init, onLocaleChange: () => render() });

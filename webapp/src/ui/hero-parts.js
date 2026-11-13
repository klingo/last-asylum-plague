/**
 * The pieces of a hero board that the hero pages (My Heroes, Gear Upgrade Path, Skill Upgrade Path) share: the hero factions
 * and their switch (Warriors | Rangers | Warlocks), the squad's order of a faction's heroes, a hero's portrait with name and
 * class (with the frame an awakening gives), and the game's faction / class badges (assets/gear/factions, assets/gear/classes). The labels are the code labels `gear.faction.*` / `gear.class.*`.
 */
import { enumLabel, localizedName, t } from './i18n.js';
import { escapeHtml } from './html.js';
import { BASE_URL } from './base-url.js';
import { awakeningFrame, hasAwakenedPortrait } from '../core/hero-stars.js';

const ASSETS = `${BASE_URL}assets/`;
// In this order on the faction switch.
const FACTIONS = ['warrior', 'ranger', 'warlock'];

/** A hero's name (`heroes`: the hero map of the pack data); the id if the hero is unknown. */
const heroName = (heroes, heroId) => localizedName(heroes?.[heroId]?.name) || heroId;
/** The URL of a hero's portrait. */
const heroImage = (heroes, heroId) => `${ASSETS}heroes/${escapeHtml(heroes?.[heroId]?.image ?? heroId)}.png`;
/** The URL of a hero's awakened portrait (from awakening level 40, `hasAwakenedPortrait`). */
const awakenedHeroImage = (heroes, heroId) =>
    `${ASSETS}heroes/awakened/${escapeHtml(heroes?.[heroId]?.image ?? heroId)}.png`;
/** The URL of a skill's icon (`id` of a skill in data/hero_skills.json). */
const skillImage = (id) => `${ASSETS}heroes/skills/${escapeHtml(id)}.png`;
/** The URL of the portrait frame of an awakening level (`AWAKENING_FRAMES` of core/hero-stars.js). */
const frameImage = (frame) => `${ASSETS}heroes/frames/awakening_${frame}.png`;
/** The URL of the padlock on the awakening milestones that are not reached yet. */
const lockImage = `${ASSETS}ui/lock.png`;
/** The URL of a hero's exclusive weapon picture. */
const weaponImage = (heroId) => `${ASSETS}heroes/weapons/${escapeHtml(heroId)}.png`;
/** The picture of a star icon (`YELLOW_STAR` / `starIcons` of core/hero-stars.js). */
const starImage = (icon) => `${ASSETS}gear/stars/${icon}.png`;
const factionIcon = (faction) => `<img class="hero-badge" src="${ASSETS}gear/factions/${faction}.png" alt="" />`;
const classIcon = (heroClass) => `<img class="hero-badge" src="${ASSETS}gear/classes/${heroClass}.png" alt="" />`;

/**
 * The `heroes` (ids) of a faction as the squad stands, left to right: the two tanks, then carry, support, carry (the
 * slots of the first squad guide of the pack data, as on the Gear Upgrade Path page). `heroes` as given when the guide
 * doesn't place exactly these.
 */
function squadHeroes(data, heroes, faction) {
    const guide = Object.values(data.squad_guides || {})[0];
    const standing = guide
        ? [...guide.formation.front, ...guide.formation.back].map((slot) => guide.slots[slot]?.heroes?.[faction])
        : [];
    return standing.length === heroes.length && heroes.every((hero) => standing.includes(hero)) ? standing : heroes;
}

/**
 * A hero's portrait with the name and the class beside it. The portrait has a border in the shown faction's colour; an
 * awakened hero (`awakening`, its awakening level) has the frame of its level over the portrait instead, and from
 * level 40 its awakened picture.
 */
function heroHeadHtml(heroes, heroId, heroClass, awakening = 0) {
    const name = heroName(heroes, heroId);
    const frame = awakeningFrame(awakening);
    // The frame is an element with its picture as an inline `background-image`: a relative URL in a CSS variable would be
    // resolved against the stylesheet, not the page (and break in the build, where the base is relative).
    const frameEl = frame
        ? `<span class="hero-portrait__frame" style="background-image: url('${frameImage(frame)}')"></span>`
        : '';
    return `
        <figure class="hero-head">
            <span class="hero-portrait${frame ? ' has-frame' : ''}"><img src="${hasAwakenedPortrait(awakening) ? awakenedHeroImage(heroes, heroId) : heroImage(heroes, heroId)}" alt="${escapeHtml(name)}" />${frameEl}</span>
            <figcaption>
                <strong>${escapeHtml(name)}</strong>
                <span class="hero-class">${classIcon(heroClass)}${escapeHtml(enumLabel('gear.class', heroClass))}</span>
            </figcaption>
        </figure>`;
}

/** A faction in its colour with its badge: a switch button, or (`chip`) the same look as plain text in a help. */
function factionHtml(faction, active, chip = false) {
    const classes = `hero-faction${chip ? ' hero-faction--chip' : ''}${active ? ' is-active' : ''}`;
    const style = `--faction-color: var(--faction-${faction})`;
    const label = `${factionIcon(faction)} ${escapeHtml(enumLabel('gear.faction', faction))}`;
    return chip
        ? `<span class="${classes}" style="${style}">${label}</span>`
        : `<button type="button" class="${classes}" data-faction="${faction}" style="${style}" aria-pressed="${active}">${label}</button>`;
}

/** Fills the faction switch `element` (hidden with fewer than two factions); `onPick(faction)` on a click. */
function renderFactionSwitch(element, { factions, shown, onPick }) {
    element.hidden = factions.length < 2;
    element.setAttribute('aria-label', t('gear.factions'));
    element.innerHTML = factions.map((faction) => factionHtml(faction, faction === shown)).join('');
    element.querySelectorAll('[data-faction]').forEach((button) => {
        button.addEventListener('click', () => onPick(button.dataset.faction));
    });
}

export {
    FACTIONS,
    classIcon,
    factionHtml,
    factionIcon,
    heroHeadHtml,
    heroImage,
    heroName,
    lockImage,
    renderFactionSwitch,
    skillImage,
    squadHeroes,
    starImage,
    weaponImage,
};

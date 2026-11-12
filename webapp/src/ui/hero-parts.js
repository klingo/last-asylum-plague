/**
 * The pieces of a hero board that the Gear Upgrade Path and the Skill Upgrade Path pages share: the hero factions and their
 * switch (Warriors | Rangers | Warlocks), a hero's portrait with name and class, and the game's faction / class
 * badges (assets/gear/factions, assets/gear/classes). The labels are the code labels `gear.faction.*` / `gear.class.*`.
 */
import { enumLabel, localizedName, t } from './i18n.js';
import { escapeHtml } from './html.js';
import { BASE_URL } from './base-url.js';

const ASSETS = `${BASE_URL}assets/`;
// In this order on the faction switch.
const FACTIONS = ['warrior', 'ranger', 'warlock'];

/** A hero's name (`heroes`: the hero map of the pack data); the id if the hero is unknown. */
const heroName = (heroes, heroId) => localizedName(heroes?.[heroId]?.name) || heroId;
/** The URL of a hero's portrait. */
const heroImage = (heroes, heroId) => `${ASSETS}heroes/${escapeHtml(heroes?.[heroId]?.image ?? heroId)}.png`;
const factionIcon = (faction) => `<img class="hero-badge" src="${ASSETS}gear/factions/${faction}.png" alt="" />`;
const classIcon = (heroClass) => `<img class="hero-badge" src="${ASSETS}gear/classes/${heroClass}.png" alt="" />`;

/** A hero's portrait (framed in the shown faction's colour) with the name and the class beside it. */
function heroHeadHtml(heroes, heroId, heroClass) {
    const name = heroName(heroes, heroId);
    return `
        <figure class="hero-head">
            <img src="${heroImage(heroes, heroId)}" alt="${escapeHtml(name)}" />
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

export { FACTIONS, classIcon, factionHtml, factionIcon, heroHeadHtml, heroImage, heroName, renderFactionSwitch };

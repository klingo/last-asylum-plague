/**
 * The "How it works" panel with its sample tiles.
 */
import { enumLabel, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml, itemIconSlot } from '../../ui/html.js';
import { classIcon, factionHtml } from '../../ui/hero-parts.js';
import { ctx } from './state.js';
import { replaceItemIcons, tileHtml } from './board.js';
import { ACTION_ICONS, LANE_ICONS } from './constants.js';
import { help } from './elements.js';
import { actionLabel, blockedHtml, needOf, starStripHtml, stepHtml } from './guide.js';
import { formatStars, heroImage, heroName, heroOf, icon, itemName, laneName } from './helpers.js';

/** A button inside a help sentence, as it looks on the page: "✓ Done". */
const chipHtml = (action) => `<span class="step-chip">${actionLabel(action)}</span>`;

/**
 * "How it works", in the order you use the page: what it does, the faction, reading the squad, crafting, upgrading,
 * blocked steps (rules from the data and an example from the path), the MR switch, mistakes and saving.
 */
function renderHelp() {
    const section = (symbol, titleKey, body) => `
        <section>
            <h3>${icon(symbol)} ${tHtml(titleKey)}</h3>
            ${body}
        </section>`;
    const p = (key, html = {}, params = {}) => `<p>${tHtml(key, { ...params, ...html })}</p>`;
    const itemHtml = (item) =>
        `<span class="gear-help__piece">${itemIconSlot(item)}${escapeHtml(itemName(item))}</span>`;
    const blueprints = ctx.gearSet.blueprints || {};

    // The squad: the factions (as on the switch), the formation with the heroes of the faction shown.
    const factionChips = ctx.factions
        .map((faction) => factionHtml(faction, faction === ctx.shownFaction, true))
        .join('');
    const slotChip = (slot) => {
        const { class: heroClass } = ctx.guide.slots[slot];
        return `<span class="gear-help__slot"><img class="hero-face" src="${heroImage(heroOf(slot))}" alt="" />${classIcon(heroClass)}${escapeHtml(enumLabel('gear.class', heroClass))} <span class="text-dim">${escapeHtml(heroName(heroOf(slot)))}</span></span>`;
    };
    const formation = `
        <div class="gear-help__formation">
            <div class="gear-help__row"><span class="gear-help__row-label">${tHtml('gear.frontRow')}</span>${ctx.guide.formation.front.map(slotChip).join('')}</div>
            <div class="gear-help__row"><span class="gear-help__row-label">${tHtml('gear.backRow')}</span>${ctx.guide.formation.back.map(slotChip).join('')}</div>
        </div>`;

    // Reading the squad: the 2×2 square, and sample tiles drawn like the board's.
    const [sampleItem] = ctx.gearSet.layout.flat();
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
        id ? `<span class="gear-help__piece">${itemIconSlot(id)}${escapeHtml(itemName(id))}</span>` : '';
    const upgradeCards = `
        <div class="gear-help__cards">
            <div class="gear-help__card gear-help__card--level">
                <h4>${icon(LANE_ICONS.level)} ${tHtml('gear.lane.level')}</h4>
                ${p('gear.help.levelText', {}, { max: ctx.gearSet.max_level })}
            </div>
            <div class="gear-help__card gear-help__card--stars">
                <h4>${icon(LANE_ICONS.stars)} ${tHtml('gear.lane.stars')}</h4>
                ${p('gear.help.starsText', { ur: blueprintHtml(blueprints.ur), mr: blueprintHtml(blueprints.mr) })}
                <div class="gear-help__star-example">${starStripHtml(2, 'gear-help__stars')} → ${starStripHtml(4, 'gear-help__stars')} → ${starStripHtml(5, 'gear-help__stars')}</div>
            </div>
        </div>`;

    // Blocked steps: the rules from the data, and the first level step of the path that waits for a star step.
    const rows = [0, 1, 2, 3, 4, 5]
        .map((stars) => {
            const needs = ctx.gearSet.min_level_for_star?.[stars];
            const cap = stars < 5 ? ctx.gearSet.level_cap_by_stars?.[stars] : ctx.gearSet.max_level;
            return `<tr>
                <td>${starStripHtml(stars, 'gear-help__stars')} <span class="text-dim">${stars === 5 ? tHtml('gear.toMr') : `${stars} ★`}</span></td>
                <td class="text-right">${needs ? tHtml('gear.level', { level: needs }) : t('common.dash')}</td>
                <td class="text-right">${cap ? tHtml('gear.level', { level: cap }) : t('common.dash')}</td>
            </tr>`;
        })
        .join('');
    const example = ctx.progress.entriesOf.level.find((entry) => entry.needs && entry.needs.n !== null);
    const exampleHtml = example
        ? `
        <div class="gear-help__example">
            <div class="step-card gear-next--level">
                <div class="step-card__head"><h4>${icon(LANE_ICONS.level)} ${tHtml('gear.nextLevel')}</h4></div>
                <p class="gear-next__step">${stepHtml(example)}</p>
                <div class="step-card__actions"><span class="step-chip is-disabled">${actionLabel('done')}</span></div>
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
            <div class="gear-help__square">${ctx.gearSet.layout.flat().map(itemHtml).join('')}</div>
            ${p('gear.help.tileText')}
            <div class="gear-help__samples">${pieceSamples.join('')}</div>
            ${p('gear.help.nextText')}
            <div class="gear-help__samples">${nextSamples.join('')}</div>`,
        ),
        section(
            LANE_ICONS.craft,
            'gear.help.craftTitle',
            p('gear.help.craftText', { done: chipHtml('done') }, { count: ctx.progress.entriesOf.craft.length }) +
                p('gear.help.craftAllText', { craftAll: chipHtml('craftAll') }) +
                p('gear.help.craftUnlock'),
        ),
        section(
            `${LANE_ICONS.level} ${LANE_ICONS.stars}`,
            'gear.help.upgradesTitle',
            `${p('gear.help.upgradesText')}${upgradeCards}<p class="gear-help__decision">${blueprints.ur ? itemIconSlot(blueprints.ur) : ''}${tHtml('gear.choiceHint')}</p>`,
        ),
        section(
            ACTION_ICONS.blocked,
            'gear.help.blockedTitle',
            `${p('gear.help.blockedIntro')}
            <div class="table-wrap">
                <table class="gear-help__rules">
                    <thead><tr>
                        <th>${tHtml('gear.help.rulesStars')}</th>
                        <th class="text-right">${tHtml('gear.help.rulesNeeds')}</th>
                        <th class="text-right">${tHtml('gear.help.rulesMax')}</th>
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
                <li>${tHtml('gear.help.undoText', { undo: chipHtml('undo') })}</li>
                <li>${tHtml('gear.help.listText')}</li>
                <li>${tHtml('gear.help.resetText', { startOver: chipHtml('startOver') })}</li>
                <li>${tHtml('gear.help.savedText')}</li>
            </ul>`,
        ),
    ].join('');
    help.querySelectorAll('.gear-help__example, .gear-help__samples').forEach((root) =>
        replaceItemIcons(root, root.matches('.gear-help__samples') ? 'item-icon' : 'item-icon item-icon--xs'),
    );
    replaceItemIcons(help, 'item-icon item-icon--sm');
}

export { renderHelp };

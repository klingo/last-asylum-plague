/**
 * The "How it works" panel.
 */
import { tHtml } from '../../ui/i18n.js';
import { factionHtml } from '../../ui/hero-parts.js';
import { ctx } from './state.js';
import { help } from './elements.js';
import { actionLabel, foundationVars } from './guide.js';

/** A button inside a help sentence, as it looks on the page: "✓ Done". */
const chipHtml = (action) => `<span class="step-chip">${actionLabel(action)}</span>`;

/** "How it works", in the order you use the page: what it does, the faction, the board, the two phases, the details. */
function renderHelp() {
    const section = (titleKey, body) => `<section><h3>${tHtml(titleKey)}</h3>${body}</section>`;
    const p = (key, vars = {}) => `<p>${tHtml(key, vars)}</p>`;
    const factionChips = ctx.factions
        .map((faction) => factionHtml(faction, faction === ctx.shownFaction, true))
        .join('');
    help.innerHTML = [
        section('skills.help.aboutTitle', p('skills.help.aboutText')),
        section(
            'skills.help.squadTitle',
            `<div class="skills-help__factions">${factionChips}</div>${p('skills.help.squadText')}`,
        ),
        section('skills.help.boardTitle', p('skills.help.boardText')),
        section('skills.help.foundationTitle', p('skills.help.foundationText', foundationVars())),
        section('skills.help.pathTitle', p('skills.help.pathText', foundationVars())),
        section('skills.help.tenacityTitle', p('skills.help.tenacityText')),
        section('skills.help.awakeningTitle', p('skills.help.awakeningText', { max: ctx.skills.max_level })),
        section('skills.help.detailTitle', p('skills.help.detailText')),
        section(
            'skills.help.fixTitle',
            `<ul class="skills-help__list">
                <li>${tHtml('skills.help.undoText', { undo: chipHtml('undo') })}</li>
                <li>${tHtml('skills.help.listText')}</li>
                <li>${tHtml('skills.help.resetText', { startOver: chipHtml('startOver') })}</li>
                <li>${tHtml('skills.help.savedText')}</li>
            </ul>`,
        ),
    ].join('');
}

export { renderHelp };

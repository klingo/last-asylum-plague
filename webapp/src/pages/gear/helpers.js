/**
 * Names, images and small markup pieces shared by the board, the guide and the help.
 */
import { t } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { itemDisplayText, itemLinkHtml } from '../../ui/labels.js';
import { formatThousands } from '../../ui/format.js';
import { heroImage as heroImageOf, heroName as heroNameOf } from '../../ui/hero-parts.js';
import { ctx } from './state.js';
import { LANE_ICONS } from './constants.js';

// Which full step lists are open ("Show all steps"), kept across re-renders.
const openLists = new Set();

const itemName = (itemId) => itemDisplayText(ctx.data.items, itemId);
// A blueprint's name, linked to Item Sources (where to get it).
const blueprintLink = (itemId) => itemLinkHtml(ctx.data.items, itemId, escapeHtml(itemName(itemId)));
const heroName = (heroId) => heroNameOf(ctx.data.heroes, heroId);
// A slot's hero in the faction shown.
const heroOf = (slot) => ctx.guide.slots[slot]?.heroes?.[ctx.shownFaction];
const heroImage = (heroId) => heroImageOf(ctx.data.heroes, heroId);
const icon = (symbol) => `<span class="gear-icon" aria-hidden="true">${symbol}</span>`;
// "★ Stars": a lane's name with its icon (plain text, for texts that are escaped as a whole).
const laneName = (path) => `${LANE_ICONS[path]} ${t(`gear.lane.${path}`)}`;
// Stars as written in the game (2.6, 4), one decimal at most, in the app's number style in every language.
const formatStars = (stars) => formatThousands(Number(stars.toFixed(1)));

export { blueprintLink, formatStars, heroImage, heroName, heroOf, icon, itemName, laneName, openLists };

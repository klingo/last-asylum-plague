/**
 * Names, images and small markup pieces shared by the board, the guide and the help.
 */
import { localizedName, t } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { itemDisplayText, itemLinkHtml } from '../../ui/labels.js';
import { formatThousands } from '../../ui/format.js';
import { ctx } from './state.js';
import { ASSETS, LANE_ICONS } from './constants.js';

// Which full step lists are open ("Show all steps"), kept across re-renders.
const openLists = new Set();

const itemName = (itemId) => itemDisplayText(ctx.data.items, itemId);
// A blueprint's name, linked to Item Sources (where to get it).
const blueprintLink = (itemId) => itemLinkHtml(ctx.data.items, itemId, escapeHtml(itemName(itemId)));
const heroName = (heroId) => localizedName(ctx.data.heroes?.[heroId]?.name) || heroId;
// A slot's hero in the faction shown.
const heroOf = (slot) => ctx.guide.slots[slot]?.heroes?.[ctx.shownFaction];
const heroImage = (heroId) => `${ASSETS}heroes/${escapeHtml(ctx.data.heroes?.[heroId]?.image ?? heroId)}.png`;
const icon = (symbol) => `<span class="gear-icon" aria-hidden="true">${symbol}</span>`;
const factionIcon = (faction) => `<img class="gear-badge" src="${ASSETS}gear/factions/${faction}.png" alt="" />`;
const classIcon = (heroClass) => `<img class="gear-badge" src="${ASSETS}gear/classes/${heroClass}.png" alt="" />`;
// "★ Stars": a lane's name with its icon (plain text, for texts that are escaped as a whole).
const laneName = (path) => `${LANE_ICONS[path]} ${t(`gear.lane.${path}`)}`;
// Stars as written in the game (2.6, 4), one decimal at most, in the app's number style in every language.
const formatStars = (stars) => formatThousands(Number(stars.toFixed(1)));

export {
    blueprintLink,
    classIcon,
    factionIcon,
    formatStars,
    heroImage,
    heroName,
    heroOf,
    icon,
    itemName,
    laneName,
    openLists,
};

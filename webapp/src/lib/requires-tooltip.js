/**
 * Shared "requires" info-icon + tooltip markup for any table that shows a package's (or
 * item's) prerequisite. Used identically by the Analyze Item Value and Value Ranking pages,
 * paired with `enableInfoTooltips()` (see lib/tooltip.js) to wire up the hover/focus behavior
 * once the markup is in the DOM.
 */
import { localizedName, t } from './i18n';
import { packageDisplayName } from './labels';

// Small "i in a circle" icon; the button itself carries the accessible name (aria-label), so
// the SVG is purely decorative.
const INFO_ICON_SVG =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">' +
    '<circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3" />' +
    '<circle cx="8" cy="4.8" r="0.9" fill="currentColor" />' +
    '<rect x="7.3" y="7" width="1.4" height="4.6" rx="0.7" fill="currentColor" />' +
    '</svg>';

function getResolvedRequiresName(requiresId, packages, items, locale) {
    const requiredPackage = packages[requiresId];
    if (requiredPackage) {
        return packageDisplayName(requiredPackage, locale);
    }
    return localizedName(items[requiresId]?.name, locale) || requiresId;
}

/** Info-icon button showing `text` as tooltip (pair with `enableInfoTooltips()`). */
function infoIconHtml(text) {
    const label = String(text).replace(/"/g, '&quot;');
    return `<button type="button" class="info-icon" data-tooltip="${label}" aria-label="${label}">${INFO_ICON_SVG}</button>`;
}

/**
 * Returns the info-icon button markup for `requiresId`, or `''` when there's nothing to show.
 */
function requiresIconHtml(requiresId, packages, items, locale) {
    if (!requiresId) {
        return '';
    }
    const requiresName = getResolvedRequiresName(requiresId, packages, items, locale);
    const label = t('analyze.table.requiresTooltip', { name: requiresName });
    return `<button type="button" class="info-icon" data-tooltip="${label}" aria-label="${label}">${INFO_ICON_SVG}</button>`;
}

export { requiresIconHtml, getResolvedRequiresName, infoIconHtml };

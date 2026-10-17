/**
 * The small "i" info icon whose text shows as a tooltip (pair with `enableInfoTooltips()` from tooltip.js,
 * once the markup is in the DOM), and its use for a package's prerequisite ("Requires: <lower tier>").
 */
import { localizedName, t } from './i18n.js';
import { packageDisplayName } from './labels.js';
import { escapeAttr } from './html.js';

// "i" in a circle; the button itself carries the accessible name (aria-label), so the SVG is decorative.
const INFO_ICON_SVG =
    '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">' +
    '<circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.3" />' +
    '<circle cx="8" cy="4.8" r="0.9" fill="currentColor" />' +
    '<rect x="7.3" y="7" width="1.4" height="4.6" rx="0.7" fill="currentColor" />' +
    '</svg>';

/** Info-icon button showing `text` (markup-safe text, e.g. with escaped names) as its tooltip. */
function infoIconHtml(text) {
    const label = escapeAttr(text);
    return `<button type="button" class="info-icon" data-tooltip="${label}" aria-label="${label}">${INFO_ICON_SVG}</button>`;
}

/** Name of what `requiresId` stands for: a package (with its tier) or an item. */
function requiredName(requiresId, packages, items, locale) {
    const requiredPackage = packages[requiresId];
    if (requiredPackage) {
        return packageDisplayName(requiredPackage, locale);
    }
    return localizedName(items[requiresId]?.name, locale) || requiresId;
}

/** "Requires: …" info icon for `requiresId`, or '' when there's nothing to show. */
function requiresIconHtml(requiresId, packages, items, locale) {
    if (!requiresId) {
        return '';
    }
    return infoIconHtml(t('common.requiresTooltip', { name: requiredName(requiresId, packages, items, locale) }));
}

export { infoIconHtml, requiresIconHtml };

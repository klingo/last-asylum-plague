/**
 * Small markup helpers shared by the pages: escaping, Banknote amounts and item icons.
 *
 * Item icons are rendered as placeholders (`itemIconSlot`) inside a page's markup and swapped for the real
 * <img> once the markup is in the DOM (`hydrateItemIcons`), which wires up the image fallbacks (images.js).
 */
import { banknoteIconHtml, createItemImage } from './images.js';

/**
 * Text for HTML content and double-quoted attribute values ("<Hero> Shard" stays text). Apostrophes are
 * kept: names like "Attacker's Claw" are also searched as they're shown.
 */
function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * An attribute value that already is markup-safe text (e.g. a label built from escaped names): only the
 * quotes are escaped, so existing entities aren't escaped twice.
 */
function escapeAttr(text) {
    return String(text).replace(/"/g, '&quot;');
}

/** A Banknote amount (already formatted): gold, with the Banknote icon. Gold is reserved for Banknotes. */
function banknotesHtml(text) {
    return `<span class="text-gold">${text}</span> ${banknoteIconHtml()}`;
}

/** Placeholder for an item's icon (see hydrateItemIcons). */
function itemIconSlot(itemId) {
    return `<span data-item-id="${escapeHtml(itemId)}"></span>`;
}

/** Replaces every icon placeholder under `root` by the item's image. `alt(itemId)`: its alt text. */
function hydrateItemIcons(root, className = 'item-icon item-icon--sm', alt = (itemId) => itemId) {
    root.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        placeholder.replaceWith(createItemImage(itemId, alt(itemId), className));
    });
}

export { escapeHtml, escapeAttr, banknotesHtml, itemIconSlot, hydrateItemIcons };

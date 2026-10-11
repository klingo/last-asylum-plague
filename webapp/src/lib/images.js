/**
 * Item image handling. No real item images exist yet, so this simply establishes the
 * convention (assets/items/<item_id>.png) and a graceful fallback to a placeholder icon,
 * so images can be dropped in later without touching any rendering code.
 */
import { t } from './i18n';

const PLACEHOLDER_ICON = `${import.meta.env.BASE_URL}icons/placeholder-item.svg`;
const BANKNOTE_ICON_URL = `${import.meta.env.BASE_URL}assets/currencies/banknote.png`;

// itemId -> item id whose image it borrows (the data's `image` field), set when the data is loaded.
const imageAliases = new Map();

/** Registers every item's `image` reference (items without an image of their own). */
function setItemImageAliases(items) {
    imageAliases.clear();
    for (const [id, item] of Object.entries(items || {})) {
        if (item.image) {
            imageAliases.set(id, item.image);
        }
    }
}

function getItemImageUrl(itemId) {
    return `${import.meta.env.BASE_URL}assets/items/${imageAliases.get(itemId) ?? itemId}.png`;
}

/**
 * Returns an <img> markup string for the Banknotes currency icon, meant to be used next to
 * a Banknotes amount instead of (or in addition to) the word "Banknotes".
 */
function banknoteIconHtml(className = 'currency-icon') {
    return `<img src="${BANKNOTE_ICON_URL}" alt="${t('currency.banknotes')}" class="${className}" />`;
}

/**
 * Creates an <img> element for the given item id, pre-wired to fall back to the
 * placeholder icon if the real image doesn't exist (which is currently always the case).
 */
function createItemImage(itemId, altText, className = 'item-icon') {
    const img = document.createElement('img');
    img.src = getItemImageUrl(itemId);
    img.alt = altText || itemId;
    img.className = className;
    img.loading = 'lazy';
    img.onerror = () => {
        img.onerror = null;
        img.src = PLACEHOLDER_ICON;
        img.classList.add('item-icon--placeholder');
    };
    return img;
}

export { getItemImageUrl, setItemImageAliases, createItemImage, PLACEHOLDER_ICON, banknoteIconHtml, BANKNOTE_ICON_URL };

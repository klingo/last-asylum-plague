/**
 * Item image handling: assets/items/<category>/<image>.png, sorted by the item's `category`. An image
 * not sorted into its folder yet is found directly in assets/items/; a missing one falls back to a
 * placeholder icon, so images can be dropped in later without touching any rendering code.
 */
import { t, localizedName } from './i18n.js';

const PLACEHOLDER_ICON = `${import.meta.env.BASE_URL}icons/placeholder-item.svg`;
const BANKNOTE_ICON_URL = `${import.meta.env.BASE_URL}assets/currencies/banknote.png`;
const ITEM_IMAGES_URL = `${import.meta.env.BASE_URL}assets/items/`;

// itemId -> { urls, name, rarity }, built from the data when it's loaded. `urls`: where its image may be, in
// the order tried (category folder, then unsorted). Image URLs are only ever taken from here, never built from
// an id read back from the page, so an id the data doesn't know gets the placeholder.
const itemImages = new Map();

/** URL of "<segment>/.../<last>.png" below assets/items, every segment URL-encoded. */
function imageUrl(...segments) {
    return `${ITEM_IMAGES_URL}${segments.map(encodeURIComponent).join('/')}.png`;
}

/**
 * Registers every item's image, name and rarity. The image is the item's own id or the `image` it borrows;
 * it lives in assets/items/<category>/ (the category of the item the image belongs to, else the item's own),
 * or directly in assets/items/ while it isn't sorted yet.
 */
function setItemImageAliases(items) {
    itemImages.clear();
    for (const [id, item] of Object.entries(items || {})) {
        const image = item.image ?? id;
        const category = items[image]?.category ?? item.category;
        const unsorted = imageUrl(image);
        itemImages.set(id, {
            urls: category ? [imageUrl(category, image), unsorted] : [unsorted],
            name: item.name,
            rarity: item.rarity || null,
        });
    }
}

/** The class that colours an item image's border by the item's rarity ('' = the neutral border). */
function rarityClass(itemId) {
    const rarity = itemImages.get(itemId)?.rarity;
    return rarity ? `item-icon--${rarity}` : '';
}

/**
 * Sets an item's image on an <img>: its category folder first, then the unsorted assets/items folder,
 * then `onMissing()` (placeholder, hide, ...). An item the data doesn't know goes straight to `onMissing()`.
 */
function setItemImageSrc(img, itemId, onMissing) {
    const urls = [...(itemImages.get(itemId)?.urls ?? [])];
    const tryNext = () => {
        if (urls.length === 0) {
            img.onerror = null;
            onMissing();
            return;
        }
        img.src = urls.shift();
    };
    img.onerror = tryNext;
    tryNext();
}

/**
 * Returns an <img> markup string for the Banknotes currency icon, meant to be used next to
 * a Banknotes amount instead of (or in addition to) the word "Banknotes".
 */
function banknoteIconHtml(className = 'currency-icon') {
    const name = t('currency.banknotes');
    return `<img src="${BANKNOTE_ICON_URL}" alt="${name}" title="${name}" class="${className}" />`;
}

/**
 * Creates an <img> element for the given item id, pre-wired to fall back to the
 * placeholder icon if the real image doesn't exist. Its mouse-over title is the item's name (e.g. which
 * currency a coin icon stands for).
 */
function createItemImage(itemId, altText, className = 'item-icon') {
    const img = document.createElement('img');
    const name = localizedName(itemImages.get(itemId)?.name);
    img.alt = altText || itemId;
    if (name) {
        img.title = name;
    }
    img.className = className;
    if (rarityClass(itemId)) {
        img.classList.add(rarityClass(itemId));
    }
    img.loading = 'lazy';
    setItemImageSrc(img, itemId, () => {
        img.src = PLACEHOLDER_ICON;
        img.classList.add('item-icon--placeholder');
    });
    return img;
}

export {
    setItemImageSrc,
    setItemImageAliases,
    rarityClass,
    createItemImage,
    PLACEHOLDER_ICON,
    banknoteIconHtml,
    BANKNOTE_ICON_URL,
};

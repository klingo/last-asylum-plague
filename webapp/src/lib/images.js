/**
 * Item image handling: assets/items/<category>/<image>.png, sorted by the item's `category`. An image
 * not sorted into its folder yet is found directly in assets/items/; a missing one falls back to a
 * placeholder icon, so images can be dropped in later without touching any rendering code.
 */
import { t, localizedName } from './i18n';

const PLACEHOLDER_ICON = `${import.meta.env.BASE_URL}icons/placeholder-item.svg`;
const BANKNOTE_ICON_URL = `${import.meta.env.BASE_URL}assets/currencies/banknote.png`;

// itemId -> item id whose image it borrows (the data's `image` field), set when the data is loaded.
const imageAliases = new Map();
// itemId -> its localized `name` field, for the images' mouse-over title.
const itemNames = new Map();
// itemId -> its `rarity` ("mr", "ur", "ssr", "sr", "r"), which colours the image's border.
const itemRarities = new Map();
// itemId -> its `category`: the sub-folder of assets/items its image lives in.
const itemCategories = new Map();

/** Registers every item's `image` reference (items without an image of their own), name, rarity and category. */
function setItemImageAliases(items) {
    imageAliases.clear();
    itemNames.clear();
    itemRarities.clear();
    itemCategories.clear();
    for (const [id, item] of Object.entries(items || {})) {
        if (item.image) {
            imageAliases.set(id, item.image);
        }
        if (item.rarity) {
            itemRarities.set(id, item.rarity);
        }
        if (item.category) {
            itemCategories.set(id, item.category);
        }
        itemNames.set(id, item.name);
    }
}

/** The class that colours an item image's border by the item's rarity ('' = the neutral border). */
function rarityClass(itemId) {
    return itemRarities.has(itemId) ? `item-icon--${itemRarities.get(itemId)}` : '';
}

/**
 * assets/items/<category>/<image>.png. The image is the item's own id or the `image` it borrows; the
 * folder is the category of the item the image belongs to (the borrowed item's, else its own).
 */
function getItemImageUrl(itemId) {
    const image = imageAliases.get(itemId) ?? itemId;
    const category = itemCategories.get(image) ?? itemCategories.get(itemId);
    return category ? `${import.meta.env.BASE_URL}assets/items/${category}/${image}.png` : unsortedImageUrl(itemId);
}

/** The same image directly in assets/items, not sorted into its category folder (yet). */
function unsortedImageUrl(itemId) {
    return `${import.meta.env.BASE_URL}assets/items/${imageAliases.get(itemId) ?? itemId}.png`;
}

/**
 * Sets an item's image on an <img>: its category folder first, then the unsorted assets/items folder,
 * then `onMissing()` (placeholder, hide, ...).
 */
function setItemImageSrc(img, itemId, onMissing) {
    const sorted = getItemImageUrl(itemId);
    const unsorted = unsortedImageUrl(itemId);
    let triedUnsorted = sorted === unsorted;
    img.onerror = () => {
        if (!triedUnsorted) {
            triedUnsorted = true;
            img.src = unsorted;
            return;
        }
        img.onerror = null;
        onMissing();
    };
    img.src = sorted;
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
    const name = itemNames.has(itemId) ? localizedName(itemNames.get(itemId)) : '';
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
    getItemImageUrl,
    setItemImageSrc,
    setItemImageAliases,
    rarityClass,
    createItemImage,
    PLACEHOLDER_ICON,
    banknoteIconHtml,
    BANKNOTE_ICON_URL,
};

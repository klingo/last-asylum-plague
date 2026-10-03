/**
 * Display-only naming helpers shared by the pages (tier suffixes, source-type pills). Names are
 * HTML-escaped (pages insert them as markup; data names like "<Hero> Shard" contain brackets),
 * except the `...Text` variants for plain-text use (e.g. the item picker).
 */
import { localizedName, t } from './i18n';
import { isPassCategory } from './catalog.js';
import { formatThousands } from './format';

function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A package's plain-text name, with a localized "(Tier N)" suffix when it belongs to a tier ladder. */
function packageDisplayText(pkg, locale) {
    const name = localizedName(pkg.name, locale);
    return pkg.tier != null ? `${name} ${t('common.tierSuffix', { tier: pkg.tier })}` : name;
}

/** packageDisplayText, HTML-escaped. */
function packageDisplayName(pkg, locale) {
    return escapeHtml(packageDisplayText(pkg, locale));
}

function itemDisplayName(items, itemId, locale) {
    return escapeHtml(localizedName(items[itemId]?.name, locale) || itemId);
}

/** "<Shop> - <Item> ×<qty>" name of an exchange-shop offer (a shop can sell one item in several sizes). */
function offerDisplayName(shop, offer, items, locale) {
    const item = itemDisplayName(items, offer.item_id, locale);
    return `${escapeHtml(localizedName(shop.name, locale))} - ${item} ×${formatThousands(offer.quantity)}`;
}

/**
 * Pill type for a source row: packages that are passes or special-event offers get their own
 * pill; everything else keeps its type ('package', 'exchange', 'bonus_tier').
 */
function displaySourceType(type, category) {
    if (type !== 'package') {
        return type;
    }
    if (isPassCategory(category)) {
        return 'pass';
    }
    return category === 'special_event' ? 'special' : type;
}

/** "Item ×qty + Item ×qty" label of a choice option / ingredient list. */
function bundleLabel(contents, items, locale) {
    return Object.entries(contents)
        .map(([id, qty]) => `${itemDisplayName(items, id, locale)} ×${formatThousands(qty)}`)
        .join(' + ');
}

/** Label of a planner conversion step (acquire.js): open, craft, pick, substitute. */
function conversionLabel(conversion, items, locale) {
    const name = itemDisplayName(items, conversion.itemId, locale);
    if (conversion.kind === 'substitute') {
        return t('conversion.substitute', {
            item: name,
            target: itemDisplayName(items, conversion.targetId, locale),
        });
    }
    if (conversion.kind === 'craft' && conversion.ingredients) {
        return t('conversion.recipe', {
            item: name,
            ingredients: bundleLabel(conversion.ingredients, items, locale),
        });
    }
    if (conversion.kind === 'pick') {
        return t('conversion.pick', { item: name, option: bundleLabel(conversion.option, items, locale) });
    }
    return t(`conversion.${conversion.kind}`, { item: name });
}

/** Today's weekday index, Monday = 0 (weekly limits reset on Monday). */
function todayWeekdayIndex() {
    return (new Date().getDay() + 6) % 7;
}

export {
    escapeHtml,
    packageDisplayText,
    packageDisplayName,
    itemDisplayName,
    offerDisplayName,
    displaySourceType,
    todayWeekdayIndex,
    conversionLabel,
};

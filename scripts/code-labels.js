/**
 * The labels the webapp needs for the data's codes (looked up with `enumLabel(group, code)` in
 * webapp/src/ui/i18n.js): every category of items, packages and events, every hero class and faction,
 * every weekday and purchase type, and the item picker's own groups. Used by `i18n:missing` (per language)
 * and `verify-data` (English).
 */
import { PURCHASE_TYPES, WEEKDAYS } from '../webapp/src/core/catalog.js';

// Groups the pages put into the item picker themselves (events.js, spend-rewards.js, item-picker.js).
const PICKER_GROUPS = ['shop', 'spend_track', 'other'];

/** Sorted `<group>.<code>` keys the UI texts must have for `data` (raw or normalized pack data). */
function codeLabelKeys(data) {
    const keys = new Set();
    const add = (group, code) => {
        if (code && code !== '-') {
            keys.add(`${group}.${code}`);
        }
    };
    for (const section of ['items', 'packages', 'events', 'exchange_shops']) {
        for (const entry of Object.values(data[section] || {})) {
            add('category', entry.category);
        }
    }
    PICKER_GROUPS.forEach((code) => add('category', code));
    for (const hero of Object.values(data.heroes || {})) {
        add('gear.class', hero.class);
        add('gear.faction', hero.faction);
    }
    for (const guide of Object.values(data.squad_guides || {})) {
        for (const slot of Object.values(guide.slots || {})) {
            add('gear.class', slot.class);
            Object.keys(slot.heroes || {}).forEach((faction) => add('gear.faction', faction));
        }
    }
    WEEKDAYS.forEach((day) => add('weekday', day));
    PURCHASE_TYPES.forEach((type) => add('sourceType', type));
    return [...keys].sort();
}

/** The keys of `codeLabelKeys` without a non-empty text in `dictionary` (an i18n/<lang>.json). */
function missingCodeLabels(data, dictionary) {
    const lookup = (key) => key.split('.').reduce((node, part) => node?.[part], dictionary);
    return codeLabelKeys(data).filter((key) => {
        const text = lookup(key);
        return !(typeof text === 'string' && text.trim());
    });
}

export { codeLabelKeys, missingCodeLabels };

/**
 * The ranking grid (`.ranking-grid`, a CSS grid of div rows: Ranking, Spend Rewards, Events, Item Sources)
 * as small builders, the "Details" toggles shared with the <table> pages (Best Choice Pick), and the rows of
 * a bundle's contents shown in Details.
 */
import { t, enumLabel } from './i18n.js';
import { itemDisplayName } from './labels.js';
import { banknotesHtml, escapeHtml, itemIconSlot } from './html.js';
import { formatSignificant, formatThousands } from './format.js';

/** A cell; `num`: right-aligned number column. */
function gridCell(html = '', { num = false, className = '' } = {}) {
    const classes = ['ranking-grid__cell', num ? 'ranking-grid__cell--num' : '', className].filter(Boolean).join(' ');
    return `<div class="${classes}" role="cell">${html}</div>`;
}

/** A number cell. */
function gridNum(html = '') {
    return gridCell(html, { num: true });
}

/** A header cell (`label`: already translated). */
function gridHeader(label = '', { num = false } = {}) {
    return `<div class="ranking-grid__cell ranking-grid__cell--header${num ? ' ranking-grid__cell--num' : ''}" role="columnheader">${label}</div>`;
}

/** A row of cells; `buy`: a row the plan buys (tinted). */
function gridRow(cells, { buy = false } = {}) {
    return `<div class="ranking-grid__row${buy ? ' ranking-grid__row--buy' : ''}" role="row">${cells.join('')}</div>`;
}

/** The heading of a group of rows inside the grid. */
function gridSection(label) {
    return `<div class="ranking-grid__section">${label}</div>`;
}

/** The "Details" / "Hide" button of the row `key` (see wireDetailsToggles). */
function detailsToggleHtml(key, expandedKeys) {
    const open = expandedKeys.has(key);
    return `<button type="button" class="expand-toggle" data-details-for="${escapeHtml(key)}" aria-expanded="${open}">${open ? t('common.hide') : t('common.details')}</button>`;
}

/** The grid's Details block of the row `key`, open if it was open before the page re-rendered. */
function gridDetails(key, expandedKeys, html) {
    return `<div class="ranking-grid__details" data-details-key="${escapeHtml(key)}" ${expandedKeys.has(key) ? '' : 'hidden'}>${html}</div>`;
}

/**
 * Wires the Details buttons under `root`: each shows / hides every element with its `data-details-key`
 * (one grid block, or several table rows) and remembers the open ones in `expandedKeys` across re-renders.
 */
function wireDetailsToggles(root, expandedKeys) {
    root.querySelectorAll('.expand-toggle[data-details-for]').forEach((button) => {
        button.addEventListener('click', () => {
            const key = button.dataset.detailsFor;
            const open = !expandedKeys.has(key);
            if (open) {
                expandedKeys.add(key);
            } else {
                expandedKeys.delete(key);
            }
            root.querySelectorAll('[data-details-key]').forEach((element) => {
                if (element.dataset.detailsKey === key) {
                    element.hidden = !open;
                }
            });
            button.textContent = open ? t('common.hide') : t('common.details');
            button.setAttribute('aria-expanded', String(open));
        });
    });
}

/**
 * A bundle's parts (`valuation.bundle(...).parts`), most valuable first, as the Details cells: `item` (icon,
 * name × amount), `category`, `points` (each), `worth` (all of them, in Banknotes) and `unknown` (no worth).
 */
function breakdownParts(parts, data, valuation) {
    return parts
        .map((part) => ({ ...part, worth: part.qty * (valuation.worth(part.id) ?? 0) }))
        .sort((a, b) => b.worth - a.worth)
        .map((part) => ({
            id: part.id,
            item: `${itemIconSlot(part.id)}${itemDisplayName(data.items, part.id)} &times;${Number.isInteger(part.qty) ? formatThousands(part.qty) : formatSignificant(part.qty)}`,
            category: enumLabel('category', data.items[part.id]?.category),
            points: formatSignificant(valuation.points(part.id)) ?? t('common.unknown'),
            worth: banknotesHtml(formatSignificant(part.worth)),
            unknown: valuation.worth(part.id) === null,
        }));
}

export {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridSection,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
};

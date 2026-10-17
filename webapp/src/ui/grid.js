/**
 * The ranking grid (`.ranking-grid`, a CSS grid of div rows: Ranking, Spend Rewards, Events, Item Sources)
 * as small builders, the "Details" toggles shared with the <table> pages (Best Choice Pick), and the rows of
 * a bundle's contents shown in Details.
 *
 * `wide: true` on a cell / header: shown on wide screens only. On phones the grid drops those columns (see
 * `.ranking-grid__cell--wide` in style.css), so mark the same columns in every row of a grid.
 */
import { t, enumLabel } from './i18n.js';
import { itemDisplayName, itemLinkHtml } from './labels.js';
import { banknotesHtml, escapeHtml, itemIconSlot } from './html.js';
import { formatSignificant, formatThousands } from './format.js';

function cellClasses(base, { num = false, wide = false, className = '' }) {
    return [base, num ? 'ranking-grid__cell--num' : '', wide ? 'ranking-grid__cell--wide' : '', className]
        .filter(Boolean)
        .join(' ');
}

/** A cell; `num`: right-aligned number column; `wide`: wide screens only. */
function gridCell(html = '', options = {}) {
    return `<div class="${cellClasses('ranking-grid__cell', options)}" role="cell">${html}</div>`;
}

/** A number cell. */
function gridNum(html = '', options = {}) {
    return gridCell(html, { ...options, num: true });
}

/** A header cell (`label`: already translated). */
function gridHeader(label = '', options = {}) {
    return `<div class="${cellClasses('ranking-grid__cell ranking-grid__cell--header', options)}" role="columnheader">${label}</div>`;
}

/** A row of cells; `buy`: a row the plan buys (tinted). */
function gridRow(cells, { buy = false } = {}) {
    return `<div class="ranking-grid__row${buy ? ' ranking-grid__row--buy' : ''}" role="row">${cells.join('')}</div>`;
}

/** The header row and the body rows, each as a row group (for screen readers; no box of their own). */
function gridTable(headerRow, bodyHtml) {
    return `<div class="ranking-grid__group" role="rowgroup">${headerRow}</div><div class="ranking-grid__group" role="rowgroup">${bodyHtml}</div>`;
}

/** The heading of a group of rows inside the grid. */
function gridSection(label) {
    return `<div class="ranking-grid__section" role="row"><span role="cell">${label}</span></div>`;
}

/** The "Details" / "Hide" button of the row `key` (see wireDetailsToggles). */
function detailsToggleHtml(key, expandedKeys) {
    const open = expandedKeys.has(key);
    return `<button type="button" class="expand-toggle" data-details-for="${escapeHtml(key)}" aria-expanded="${open}">${open ? t('common.hide') : t('common.details')}</button>`;
}

/** The grid's Details block of the row `key`, open if it was open before the page re-rendered. */
function gridDetails(key, expandedKeys, html) {
    return `<div class="ranking-grid__details" role="rowgroup" data-details-key="${escapeHtml(key)}" ${expandedKeys.has(key) ? '' : 'hidden'}>${html}</div>`;
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
 * name linked to Item Sources × amount), `category`, `worthEach` (one unit in Banknotes, its points as the
 * mouse-over), `worth` (all of them) and `unknown` (no worth).
 */
function breakdownParts(parts, data, valuation) {
    return parts
        .map((part) => ({ ...part, worth: part.qty * (valuation.worth(part.id) ?? 0) }))
        .sort((a, b) => b.worth - a.worth)
        .map((part) => {
            const unitWorth = valuation.worth(part.id);
            const points = formatSignificant(valuation.points(part.id)) ?? t('common.unknown');
            const qty = Number.isInteger(part.qty) ? formatThousands(part.qty) : formatSignificant(part.qty);
            return {
                id: part.id,
                item: `${itemIconSlot(part.id)}${itemLinkHtml(data.items, part.id, itemDisplayName(data.items, part.id))} &times;${qty}`,
                category: enumLabel('category', data.items[part.id]?.category),
                worthEach:
                    unitWorth === null
                        ? t('common.unknown')
                        : `<span title="${escapeHtml(t('rankings.pointsTooltip', { points }))}">${banknotesHtml(formatSignificant(unitWorth))}</span>`,
                worth: banknotesHtml(formatSignificant(part.worth)),
                unknown: unitWorth === null,
            };
        });
}

export {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridTable,
    gridSection,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
};

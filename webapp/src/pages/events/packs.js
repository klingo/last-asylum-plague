/**
 * The event's packs on sale: the table with the ones the plan buys standing out, and each pack's Details.
 */
import { eventPacksOnSale } from '../../core/catalog.js';
import { eventPurchases } from '../../core/step-analysis.js';
import { selectCount } from '../../core/items.js';
import { packageDisplayName } from '../../ui/labels.js';
import { banknotesAmount, buyBadge, escapeHtml, hydrateItemIcons } from '../../ui/html.js';
import {
    gridHeader,
    gridRow,
    gridTable,
    gridDetails,
    buyForTiersHtml,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
    packPartRowHtml,
} from '../../ui/grid.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { t, getLocale } from '../../ui/i18n.js';
import { formatThousands } from '../../ui/format.js';
import { ratioCellHtml, ratioScale } from '../../ui/ratio-bar.js';
import { ctx } from './state.js';
import { WIDE, cell, headerCell, numCell } from './cells.js';
import { pageOverrides } from './context.js';
import { packsSection, packsTable } from './elements.js';

// The pack table's open Details blocks.
const packExpanded = new Set();

/** Every pack of the event on sale (also the ones the plan skips), best ratio (worth ÷ price) first. */
function eventPacks(eventId) {
    const bought = new Map(eventPurchases(ctx.valuation.plan, eventId).map((p) => [p.id, p.count]));
    return eventPacksOnSale(ctx.data.packages, eventId, { eventDaysLeft: pageOverrides().eventDaysLeft })
        .map(({ id, pkg, limit }) => {
            const b = ctx.valuation.bundle(pkg, pkg.price);
            return {
                id,
                pkg,
                limit,
                count: bought.get(id) || 0,
                worth: b.worth,
                ratio: b.incomplete ? null : b.ratio,
            };
        })
        .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
}

/** Every pack of the event on sale, like the shop's offers: the ones the plan buys stand out. */
function renderPacks({ eventId }) {
    const packs = eventId ? eventPacks(eventId) : [];
    packsSection.hidden = packs.length === 0;
    if (packsSection.hidden) {
        return;
    }
    const locale = getLocale();
    const maxRatio = ratioScale(packs.map((p) => p.ratio));
    const rows = packs.map(({ id, pkg, limit, count, worth, ratio }) => {
        const key = `pack:${id}`;
        const row = gridRow(
            [
                cell(packageDisplayName(pkg, locale)),
                numCell(formatThousands(limit), WIDE),
                numCell(banknotesAmount(pkg.price)),
                numCell(banknotesAmount(worth), WIDE),
                numCell(ratioCellHtml(ratio, maxRatio)),
                numCell(
                    count
                        ? ratio !== null && ratio < 0.995 && ctx.valuation.plan.forBonusTiers(pkg)
                            ? buyForTiersHtml(buyBadge(`×${formatThousands(count)}`))
                            : buyBadge(`×${formatThousands(count)}`)
                        : '',
                ),
                numCell(detailsToggleHtml(key, packExpanded)),
            ],
            { buy: count > 0 },
        );
        return row + packDetailsHtml(key, pkg);
    });
    const header = gridRow([
        headerCell('common.table.pack'),
        headerCell('common.table.limit', true, true),
        headerCell('common.table.price', true),
        headerCell('common.table.worth', true, true),
        headerCell('common.table.ratio', true),
        headerCell('common.table.buy', true),
        gridHeader(),
    ]);
    packsTable.innerHTML = gridTable(header, rows.join(''));
    hydrateItemIcons(packsTable);
    enableInfoTooltips(packsTable);
    wireDetailsToggles(packsTable, packExpanded);
}

/**
 * The Details block of a pack: what its worth adds up from. Each item with its amount and worth; for a pack
 * with a pick (`choice`), the always included items, the options counted (the most valuable, as the worth does)
 * and, dimmed, the ones left out.
 */
function packDetailsHtml(key, pkg) {
    const intro = (text) => `<p class="ranking-grid__details-intro">${escapeHtml(text)}</p>`;
    const itemRows = (parts, dim = false) =>
        breakdownParts(parts, ctx.data, ctx.valuation).map((part) => packPartRowHtml(part, { dim }));
    const optionParts = (indexes) =>
        indexes.flatMap((index) => ctx.valuation.bundle({ contains: pkg.choice.choices[index] }, 0).parts);
    const blocks = [];
    const fixed = itemRows(ctx.valuation.bundle({ contains: pkg.contains }, 0).parts);
    if (fixed.length > 0) {
        blocks.push((pkg.choice ? intro(t('events.packDetails.contents')) : '') + fixed.join(''));
    }
    if (pkg.choice) {
        const picked = ctx.valuation.bundle(pkg, 0).picked || [];
        const skipped = pkg.choice.choices.map((_, index) => index).filter((index) => !picked.includes(index));
        blocks.push(
            intro(
                t('events.packDetails.picks', {
                    count: formatThousands(selectCount(pkg.choice)),
                    total: formatThousands(pkg.choice.choices.length),
                }),
            ) + itemRows(optionParts(picked)).join(''),
        );
        if (skipped.length > 0) {
            blocks.push(intro(t('events.packDetails.skipped')) + itemRows(optionParts(skipped), true).join(''));
        }
    }
    return gridDetails(key, packExpanded, blocks.join(''));
}

export { renderPacks };

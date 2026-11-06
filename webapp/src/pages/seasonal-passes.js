/**
 * Seasonal Passes: pick a pass (`?pass=<family id>`; the one running today is pre-selected) to see its banner and when
 * it runs, its price, everything the whole pass gives (all tiers) with each item's worth, the pass's worth against its
 * price as a ratio, and the tiers the weekly plan buys.
 */
import { startPage } from '../ui/page.js';
import { urlParam, setUrlParams } from '../ui/url.js';
import { mountValuationPage } from '../ui/valuation-page.js';
import { getSettings } from '../ui/settings.js';
import { packageWeeklyCapacity } from '../core/catalog.js';
import { packageFamilyId, seasonalPassFamilies } from '../core/pack-data.js';
import { gameDay, runContains, scheduleRuns } from '../core/schedule.js';
import { banknotesAmount, buyBadge, hydrateItemIcons, itemIconSlot, tileHtml } from '../ui/html.js';
import { itemLinkName, packageDisplayName } from '../ui/labels.js';
import {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridTable,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
    packPartRowHtml,
} from '../ui/grid.js';
import { getLocale, localizedName, t, tHtml } from '../ui/i18n.js';
import { formatAmount, formatThousands } from '../ui/format.js';
import { ratioCellHtml, ratioScale } from '../ui/ratio-bar.js';
import { createItemPicker } from '../ui/item-picker.js';
import { mountBanner, scheduleImage } from '../ui/event-banner.js';

const passBanner = document.getElementById('pass-banner');
const passPrompt = document.getElementById('pass-prompt');
const passEmpty = document.getElementById('pass-empty');
const passContent = document.getElementById('pass-content');
const passSummary = document.getElementById('pass-summary');
const passTable = document.getElementById('pass-table');
const passNote = document.getElementById('pass-note');

let data = null;
let passPicker = null;
let valuation = null;
let recompute = null;
const expandedKeys = new Set();

const headerCell = (key, num = false, wide = false) => gridHeader(tHtml(key), { num, wide });

/** The seasonal pass families: familyId -> its tiers `[{ id, pkg }]`, lowest tier first. */
const passFamilies = () => seasonalPassFamilies(data.packages);

/** The pass's name: its first tier's, without the tier suffix. */
const passName = (tiers) => localizedName(tiers[0].pkg.name);

/** Every item the whole pass (all its tiers) gives, summed, with its worth; sorted by worth. */
function itemTotals(bundles) {
    const totals = new Map();
    for (const { parts } of bundles) {
        for (const part of parts) {
            totals.set(part.id, (totals.get(part.id) || 0) + part.qty);
        }
    }
    return [...totals]
        .map(([id, qty]) => ({ id, qty, worth: qty * (valuation.worth(id) ?? 0) }))
        .sort((a, b) => b.worth - a.worth);
}

/** The Details block of a tier: its items in the table's columns. */
function detailsHtml(key, bundle) {
    const rows = breakdownParts(bundle.parts, data, valuation).map((part) => packPartRowHtml(part));
    return gridDetails(key, expandedKeys, rows.join(''));
}

function render() {
    const familyId = passPicker.getValue();
    const tiers = passFamilies().get(familyId);
    passPrompt.hidden = Boolean(tiers) || passFamilies().size === 0;
    passEmpty.hidden = passFamilies().size > 0;
    passContent.hidden = !tiers;
    // The pass's art and when it runs: it only counts while it does.
    mountBanner(
        passBanner,
        data,
        familyId,
        tiers && { image: scheduleImage(data, familyId), name: passName(tiers) },
        render,
    );
    if (!tiers) {
        return;
    }
    const locale = getLocale();
    const bundles = tiers.map(({ pkg }) => valuation.bundle(pkg, pkg.price));
    const price = tiers.reduce((sum, { pkg }) => sum + pkg.price, 0);
    const worth = bundles.reduce((sum, b) => sum + b.worth, 0);
    const incomplete = bundles.some((b) => b.incomplete);
    const ratio = incomplete || price <= 0 ? null : worth / price;
    const bought = new Map(
        valuation.plan.purchases.filter((p) => packageFamilyId(p.id, p.pkg) === familyId).map((p) => [p.id, p.count]),
    );
    const onSale = getSettings().seasonalPasses.includes(familyId);
    const maxRatio = ratioScale([...bundles.map((b) => b.ratio), ratio]);

    // What it costs: each tier, and all of them together.
    const priceTile = tileHtml(
        t('seasonalPasses.tiles.price'),
        `<ul class="plan-list">${tiers
            .map(
                ({ pkg }) =>
                    `<li><span>${packageDisplayName(pkg, locale)}</span><span>${banknotesAmount(pkg.price)}</span></li>`,
            )
            .join('')}</ul>${
            tiers.length > 1
                ? `<div class="plan-tile__total">${tHtml('common.total')} ${banknotesAmount(price)}</div>`
                : ''
        }`,
    );

    // What it is worth against that, and whether your plan buys it.
    const verdictKey = ratio === null ? null : ratio >= 1 ? 'seasonalPasses.verdictGood' : 'seasonalPasses.verdictBad';
    const boughtText =
        bought.size === 0
            ? t('seasonalPasses.planNone')
            : t('seasonalPasses.planBuys', {
                  tiers: tiers
                      .filter(({ id }) => bought.has(id))
                      .map(({ pkg }) => packageDisplayName(pkg, locale))
                      .join(', '),
              });
    const worthTile = tileHtml(
        t('seasonalPasses.tiles.worth'),
        `<div class="plan-stat"><strong>${banknotesAmount(worth)}</strong> ${tHtml('seasonalPasses.worthFor', { price: formatThousands(price, 0) })}</div>
        ${ratio === null ? `<div class="plan-stat text-bad">${tHtml('common.table.incomplete')}</div>` : `<div class="plan-stat">${ratioCellHtml(ratio, maxRatio)}</div>`}
        ${verdictKey ? `<div class="plan-tile__note">${tHtml(verdictKey)}</div>` : ''}
        <div class="plan-tile__note text-dim">${boughtText}</div>
        ${onSale ? '' : `<div class="plan-tile__note text-warn">${tHtml('seasonalPasses.notOnSale')}</div>`}`,
    );

    // Everything the whole pass gives.
    const totals = itemTotals(bundles);
    const everythingTile = tileHtml(
        t('common.everything'),
        `<ul class="item-list">${totals
            .map(
                ({ id, qty, worth: itemWorth }) =>
                    `<li><span class="item-chip">${itemIconSlot(id)}${itemLinkName(data.items, id, locale)}</span><strong>×${formatAmount(qty)}</strong><span>${banknotesAmount(itemWorth)}</span></li>`,
            )
            .join('')}</ul>
        <div class="plan-tile__total">${tHtml('common.totalWorth')} ${banknotesAmount(worth)}</div>`,
        true,
    );
    passSummary.innerHTML = [priceTile, worthTile, everythingTile].join('');

    const rows = tiers
        .map(({ id, pkg }, index) => {
            const count = bought.get(id) || 0;
            const b = bundles[index];
            const row = gridRow(
                [
                    gridCell(packageDisplayName(pkg, locale)),
                    gridNum(formatThousands(packageWeeklyCapacity(pkg)), { wide: true }),
                    gridNum(banknotesAmount(pkg.price)),
                    gridNum(banknotesAmount(b.worth), { wide: true }),
                    gridNum(ratioCellHtml(b.incomplete ? null : b.ratio, maxRatio)),
                    gridNum(count ? buyBadge(`×${formatThousands(count)}`) : ''),
                    gridNum(detailsToggleHtml(id, expandedKeys)),
                ],
                { buy: count > 0 },
            );
            return row + detailsHtml(id, b);
        })
        .join('');
    const header = gridRow([
        headerCell('common.table.pack'),
        headerCell('common.table.limit', true, true),
        headerCell('common.table.price', true),
        headerCell('common.table.worth', true, true),
        headerCell('common.table.ratio', true),
        headerCell('common.table.buy', true),
        gridHeader(),
    ]);
    passTable.innerHTML = gridTable(header, rows);
    hydrateItemIcons(passSummary);
    hydrateItemIcons(passTable);
    wireDetailsToggles(passTable, expandedKeys);

    const days = tiers[0].pkg.delivery_days;
    passNote.textContent = `${t('seasonalPasses.note')}${days ? ` ${t('seasonalPasses.deliveryNote', { days })}` : ''}`;
}

/** The seasonal pass families the schedule shows running today (the game day). */
function runningPassIds() {
    const today = gameDay(new Date()).day;
    const families = passFamilies();
    return [...scheduleRuns(data, today)]
        .filter(
            ([id, { kind, runs }]) =>
                kind === 'pass' && families.has(id) && runs.some((run) => runContains(run, today)),
        )
        .map(([id]) => id);
}

/** The seasonal passes (one group), the ones running today with a green dot; keeps the current selection. */
function populatePassSelect() {
    const running = new Set(runningPassIds());
    passPicker.setItems(
        Object.fromEntries(
            [...passFamilies()].map(([id, tiers]) => [
                id,
                { name: tiers[0].pkg.name, category: 'seasonal_pass', now: running.has(id) },
            ]),
        ),
    );
}

startPage('seasonal-passes', {
    async init(loaded) {
        data = loaded;
        // The app's own picker (as on the other pages), not a native <select>.
        passPicker = createItemPicker({
            trigger: document.getElementById('pass-select'),
            placeholderKey: 'seasonalPasses.passPlaceholder',
            searchPlaceholderKey: 'seasonalPasses.passSearch',
            icons: false,
            onChange: () => {
                expandedKeys.clear();
                setUrlParams({ pass: passPicker.getValue() });
                render();
            },
        });
        ({ recompute } = mountValuationPage(data, {
            fields: ['budget', 'events', 'passes'],
            render: (next) => {
                valuation = next;
                render();
            },
        }));
        populatePassSelect();
        // Pre-select the pass running today (the first, should there be several); a pass in the URL (a shared link,
        // a reload, the Calendar) wins over today's.
        const [running] = runningPassIds();
        const fromUrl = urlParam('pass');
        if (fromUrl && passFamilies().has(fromUrl)) {
            passPicker.setValue(fromUrl);
        } else if (running) {
            passPicker.setValue(running);
        }
        await recompute();
    },
    onLocaleChange() {
        populatePassSelect();
        render();
    },
});

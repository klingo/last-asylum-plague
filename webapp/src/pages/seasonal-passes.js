import { startPage } from '../ui/page.js';
import { buildValuation } from '../ui/valuation.js';
import { urlParam, setUrlParams } from '../ui/url.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, onSettingsChange } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { packageWeeklyCapacity } from '../core/catalog.js';
import { packageFamilyId } from '../core/pack-data.js';
import { gameDay, scheduleRuns } from '../core/schedule.js';
import { banknotesHtml, itemIconSlot, hydrateItemIcons } from '../ui/html.js';
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
} from '../ui/grid.js';
import { getLocale, localizedName, t } from '../ui/i18n.js';
import { formatThousands, formatSignificant } from '../ui/format.js';
import { ratioBarHtml } from '../ui/ratio-bar.js';
import { createItemPicker } from '../ui/item-picker.js';
import { eventBannerHtml, scheduleImage, scheduleTiming, startCountdowns } from '../ui/event-banner.js';

// The app's own picker (as on the other pages), not a native <select>.
const passPicker = createItemPicker({
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
const passBanner = document.getElementById('pass-banner');
const passPrompt = document.getElementById('pass-prompt');
const passEmpty = document.getElementById('pass-empty');
const passContent = document.getElementById('pass-content');
const passSummary = document.getElementById('pass-summary');
const passTable = document.getElementById('pass-table');
const passNote = document.getElementById('pass-note');

let data = null;
let settings = null;
let valuation = null;
let panel = null;
const expandedKeys = new Set();

const gold = banknotesHtml;
const headerCell = (key, num = false, wide = false) => gridHeader(t(`events.table.${key}`), { num, wide });

const tileHtml = (label, body, wide = false) =>
    `<div class="plan-tile${wide ? ' plan-tile--wide' : ''}"><div class="plan-tile__label">${label}</div><div class="plan-tile__body">${body}</div></div>`;

/** The seasonal pass families: familyId -> its tiers `[{ id, pkg }]`, lowest tier first. */
function passFamilies() {
    const families = new Map();
    for (const [id, pkg] of Object.entries(data.packages || {})) {
        if (pkg.seasonal) {
            const familyId = packageFamilyId(id, pkg);
            families.set(familyId, [...(families.get(familyId) || []), { id, pkg }]);
        }
    }
    for (const tiers of families.values()) {
        tiers.sort((a, b) => (a.pkg.tier ?? 0) - (b.pkg.tier ?? 0));
    }
    return families;
}

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
    const rows = breakdownParts(bundle.parts, data, valuation).map((part) =>
        gridRow([
            gridCell(part.item, { className: 'item-cell' }),
            gridNum('', { wide: true }),
            // On phones the Worth column is hidden: the item's worth moves to the Price column.
            gridNum(`<span class="phone-only">${part.worth}</span>`),
            gridNum(part.worth, { wide: true }),
            gridNum(''),
            gridNum(''),
            gridNum(part.unknown ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>` : ''),
        ]),
    );
    return gridDetails(key, expandedKeys, rows.join(''));
}

function render() {
    const familyId = passPicker.getValue();
    const tiers = passFamilies().get(familyId);
    passPrompt.hidden = Boolean(tiers) || passFamilies().size === 0;
    passEmpty.hidden = passFamilies().size > 0;
    passContent.hidden = !tiers;
    // The pass's art and when it runs: it only counts while it does.
    passBanner.hidden = !tiers;
    passBanner.innerHTML = tiers
        ? eventBannerHtml({
              image: scheduleImage(data, familyId),
              name: passName(tiers),
              timing: scheduleTiming(data, familyId),
          })
        : '';
    // The countdown ticks; once it runs out (the pass ended or started) the banner shows the new state.
    startCountdowns(passBanner, render);
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
    const onSale = settings.seasonalPasses.includes(familyId);
    const maxRatio = Math.max(1, ...bundles.map((b) => b.ratio).filter(Number.isFinite), ratio ?? 0);

    // What it costs: each tier, and all of them together.
    const priceTile = tileHtml(
        t('seasonalPasses.tiles.price'),
        `<ul class="plan-list">${tiers
            .map(
                ({ pkg }) =>
                    `<li><span>${packageDisplayName(pkg, locale)}</span><span>${gold(formatThousands(pkg.price, 0))}</span></li>`,
            )
            .join('')}</ul>${
            tiers.length > 1
                ? `<div class="plan-tile__total">${t('events.total')} ${gold(formatThousands(price, 0))}</div>`
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
        `<div class="plan-stat"><strong>${gold(formatThousands(worth, 0))}</strong> ${t('seasonalPasses.worthFor', { price: formatThousands(price, 0) })}</div>
        ${ratio === null ? `<div class="plan-stat text-bad">${t('rankings.table.incomplete')}</div>` : `<div class="plan-stat">${ratioBarHtml(ratio, maxRatio, { digits: 3 })}</div>`}
        ${verdictKey ? `<div class="plan-tile__note">${t(verdictKey)}</div>` : ''}
        <div class="plan-tile__note text-dim">${boughtText}</div>
        ${onSale ? '' : `<div class="plan-tile__note text-warn">${t('seasonalPasses.notOnSale')}</div>`}`,
    );

    // Everything the whole pass gives.
    const totals = itemTotals(bundles);
    const everythingTile = tileHtml(
        t('events.tiles.everything'),
        `<ul class="item-list">${totals
            .map(
                ({ id, qty, worth: itemWorth }) =>
                    `<li><span class="item-chip">${itemIconSlot(id)}${itemLinkName(data.items, id, locale)}</span><strong>×${Number.isInteger(qty) ? formatThousands(qty) : formatSignificant(qty)}</strong><span>${gold(formatThousands(itemWorth, 0))}</span></li>`,
            )
            .join('')}</ul>
        <div class="plan-tile__total">${t('events.totalWorth')} ${gold(formatThousands(worth, 0))}</div>`,
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
                    gridNum(gold(formatThousands(pkg.price, 0))),
                    gridNum(gold(formatThousands(b.worth, 0)), { wide: true }),
                    gridNum(
                        b.incomplete || b.ratio === null
                            ? t('common.dash')
                            : ratioBarHtml(b.ratio, maxRatio, { digits: 3 }),
                    ),
                    gridNum(count ? `<span class="buy-badge">×${formatThousands(count)}</span>` : ''),
                    gridNum(detailsToggleHtml(id, expandedKeys)),
                ],
                { buy: count > 0 },
            );
            return row + detailsHtml(id, b);
        })
        .join('');
    const header = gridRow([
        headerCell('pack'),
        headerCell('limit', true, true),
        headerCell('price', true),
        headerCell('worth', true, true),
        headerCell('ratio', true),
        headerCell('buy', true),
        gridHeader(),
    ]);
    passTable.innerHTML = gridTable(header, rows);
    hydrateItemIcons(passSummary);
    hydrateItemIcons(passTable);
    wireDetailsToggles(passTable, expandedKeys);

    const days = tiers[0].pkg.delivery_days;
    passNote.textContent = `${t('seasonalPasses.note')}${days ? ` ${t('seasonalPasses.deliveryNote', { days })}` : ''}`;
}

/** The seasonal pass families the recorded schedule shows running today (the game day). */
function runningPassIds() {
    const today = gameDay(new Date()).day;
    const families = passFamilies();
    return [...scheduleRuns(data)]
        .filter(
            ([id, { kind, runs }]) =>
                kind === 'pass' && families.has(id) && runs.some((run) => run.start <= today && today <= run.end),
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

async function recompute() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
        panel.showRate(valuation);
        render();
    });
}

startPage('seasonal-passes', {
    async init(loaded) {
        data = loaded;
        settings = getSettings();
        panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
            fields: ['budget', 'events', 'passes'],
        });
        onSettingsChange((next) => {
            settings = next;
            recompute();
        });
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

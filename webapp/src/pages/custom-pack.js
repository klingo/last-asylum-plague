/**
 * Custom Package: a pack the user types in (fixed items, choose-1 slots, price and optionally the game's deal %), valued
 * like every pack of the Deal Ranking: worth ÷ price at the weekly spend, with the place it would take among this week's
 * packs. The pack lives in the page's URL (core/custom-pack.js has the format and the model); it never enters the plan.
 */
import { startPage } from '../ui/page.js';
import '../styles/pages/custom-pack.css';
import { urlParam, setUrlParams } from '../ui/url.js';
import { mountValuationPage } from '../ui/valuation-page.js';
import { getSettings } from '../ui/settings.js';
import { isOnSale } from '../core/catalog.js';
import {
    MAX_ITEMS,
    MAX_SLOTS,
    MAX_OPTIONS,
    parseCustomPack,
    customPackParams,
    valueCustomPack,
    dealRank,
    dealValues,
    dealCheck,
} from '../core/custom-pack.js';
import { createItemPicker } from '../ui/item-picker.js';
import { banknotesAmount, escapeAttr, hydrateItemIcons, statHtml } from '../ui/html.js';
import { breakdownParts } from '../ui/grid.js';
import { formatThousands } from '../ui/format.js';
import { ratioBarHtml, ratioScale } from '../ui/ratio-bar.js';
import { t, tHtml } from '../ui/i18n.js';

const itemsList = document.getElementById('items-list');
const slotsList = document.getElementById('slots-list');
const addItemButton = document.getElementById('add-item');
const addSlotButton = document.getElementById('add-slot');
const priceInput = document.getElementById('price-input');
const dealInput = document.getElementById('deal-input');
const resultEmpty = document.getElementById('result-empty');
const result = document.getElementById('result');
const verdict = document.getElementById('verdict');
const dealCheckLine = document.getElementById('deal-check');
const contentsTable = document.getElementById('contents-table');
const slotTables = document.getElementById('slot-tables');

let data = null;
let valuation = null;
// The pack as typed (rows may still be empty), see core/custom-pack.js.
let pack = { items: [], slots: [], price: 0, deal: 0 };
// The item pickers of the rows on the page, closed down when the rows are made again.
let pickers = [];
// What the valuation gives the result: the ratios of the packs on sale (their Deal Ranking) and the items' points as
// the game's deal % counts them.
let saleRatios = [];
let dealPoints = null;

const diamondsHtml = (value) => `<span class="text-diamond">${formatThousands(value, 0)}</span>`;

/** The ratios of every pack on sale this week that the Deal Ranking ranks. */
function packRatios() {
    const settings = getSettings();
    const rules = { activeEventIds: new Set(settings.activeEvents), seasonalPasses: settings.seasonalPasses };
    return Object.entries(data.packages)
        .filter(([id, pkg]) => isOnSale(id, pkg, rules))
        .map(([, pkg]) => valuation.bundle(pkg, pkg.price))
        .filter((b) => !b.incomplete && Number.isFinite(b.ratio))
        .map((b) => b.ratio);
}

/** Puts the cursor on the item picker of the last row of `rows` (a new row is the one to fill in). */
function focusLastPicker(rows) {
    rows.lastElementChild?.querySelector('.item-picker__trigger')?.focus();
}

/** One row of the builder: an item picker, its amount and a remove button for `entry` (`{ id, qty }`). */
function entryRow(entry, onRemove) {
    const row = document.createElement('div');
    row.className = 'custom-row';
    row.innerHTML = `
        <div><button type="button"></button></div>
        <input class="custom-row__qty" type="number" min="1" step="1" value="${entry.qty}" aria-label="${escapeAttr(t('customPack.amount'))}" />
        <button type="button" class="btn-secondary" aria-label="${escapeAttr(t('customPack.remove'))}">×</button>`;
    const picker = createItemPicker({
        trigger: row.querySelector('button'),
        onChange: (itemId) => {
            entry.id = itemId;
            update();
        },
    });
    picker.setItems(data.items);
    picker.setValue(entry.id);
    pickers.push(picker);
    row.querySelector('.custom-row__qty').addEventListener('input', (event) => {
        entry.qty = Math.floor(Number(event.target.value)) || 0;
        update();
    });
    row.lastElementChild.addEventListener('click', () => {
        onRemove();
        renderBuilder();
        update();
    });
    return row;
}

/** A choose-1 slot's box: its option rows, "Add option" and "Remove slot". */
function slotBox(options, index) {
    const box = document.createElement('div');
    box.className = 'custom-slot';
    box.innerHTML = `
        <div class="custom-slot__head">
            <span>${tHtml('customPack.slotTitle', { number: index + 1 })}</span>
            <button type="button" class="btn-secondary" data-remove-slot>${tHtml('customPack.removeSlot')}</button>
        </div>
        <div></div>
        <button type="button" class="btn-secondary" data-add-option>${tHtml('customPack.addOption')}</button>`;
    const list = box.children[1];
    list.replaceChildren(...options.map((entry, at) => entryRow(entry, () => options.splice(at, 1))));
    const addOption = box.querySelector('[data-add-option]');
    addOption.hidden = options.length >= MAX_OPTIONS;
    addOption.addEventListener('click', () => {
        options.push({ id: '', qty: 1 });
        renderBuilder();
        focusLastPicker(slotsList.children[index].children[1]);
    });
    box.querySelector('[data-remove-slot]').addEventListener('click', () => {
        pack.slots.splice(index, 1);
        renderBuilder();
        update();
    });
    return box;
}

/** The builder's rows from the pack (the pickers are made again, so a language change gets their names too). */
function renderBuilder() {
    pickers.forEach((picker) => picker.destroy());
    pickers = [];
    itemsList.replaceChildren(...pack.items.map((entry, index) => entryRow(entry, () => pack.items.splice(index, 1))));
    slotsList.replaceChildren(...pack.slots.map(slotBox));
    addItemButton.hidden = pack.items.length >= MAX_ITEMS;
    addSlotButton.hidden = pack.slots.length >= MAX_SLOTS;
}

/** A table of rows `{ item, category?, ... }` as markup: Item, Worth each and Worth, the picked or counted marked. */
function partsTable(parts) {
    const rows = parts.map(
        (part) => `
        <tr class="${part.other ? 'custom-option--other' : ''}">
            <td><span class="item-cell">${part.item}</span></td>
            <td class="table-col-wide">${part.category}</td>
            <td class="text-right">${part.worthEach}</td>
            <td class="text-right">${part.unknown ? part.incomplete : part.worth}</td>
            <td>${part.note || ''}</td>
        </tr>`,
    );
    return `
        <thead>
            <tr>
                <th>${tHtml('common.table.item')}</th>
                <th class="table-col-wide">${tHtml('common.table.category')}</th>
                <th class="text-right">${tHtml('common.table.worthEach')}</th>
                <th class="text-right">${tHtml('common.table.worth')}</th>
                <th></th>
            </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>`;
}

/** The verdict tile: worth buying or not, with the key figures. */
function verdictHtml(value) {
    const buy = value.ratio >= 1;
    const gain = value.worth - pack.price;
    const place = dealRank(value.ratio, saleRatios);
    const stats = [
        statHtml(tHtml('common.table.price'), banknotesAmount(pack.price)),
        statHtml(tHtml('common.table.worth'), banknotesAmount(value.worth)),
        statHtml(
            tHtml('common.table.ratio'),
            ratioBarHtml(value.ratio, ratioScale([value.ratio, ...saleRatios]), { digits: 3 }),
        ),
        statHtml(tHtml('customPack.stat.gain'), banknotesAmount(gain), gain >= 0 ? 'text-good' : 'text-bad'),
        statHtml(tHtml('customPack.stat.rank'), tHtml('customPack.stat.rankValue', place)),
    ];
    const text = tHtml(buy ? 'customPack.verdictBuyText' : 'customPack.verdictSkipText', {
        worth: banknotesAmount(value.worth),
        price: banknotesAmount(pack.price),
    });
    return `
        <div class="plan-tile plan-tile--wide mine-verdict mine-verdict--${buy ? 'dig' : 'save'}">
            <div class="mine-verdict__head">
                <span class="mine-verdict__badge" aria-hidden="true">${buy ? '✓' : '✗'}</span>
                <div>
                    <div class="mine-verdict__title">${tHtml(buy ? 'customPack.verdictBuy' : 'customPack.verdictSkip')}</div>
                    <div class="mine-verdict__text">${text}${value.incomplete ? ` ${tHtml('customPack.incompleteNote')}` : ''}</div>
                </div>
            </div>
            <div class="mine-stats">${stats.join('')}</div>
        </div>`;
}

/** The deal % against the model: the game's claim and the model's points, flagged when far apart. */
function dealCheckHtml() {
    const check = dealCheck(pack, dealPoints);
    if (!check) {
        return '';
    }
    if (check.incomplete) {
        return tHtml('customPack.dealCheckIncomplete');
    }
    const text = tHtml('customPack.dealCheckText', {
        claim: diamondsHtml(check.claim),
        points: diamondsHtml(check.points),
    });
    return check.flagged ? `${text} <span class="text-bad">${tHtml('customPack.dealCheckFar')}</span>` : text;
}

function renderResult() {
    if (!valuation) {
        return;
    }
    const hasItems =
        pack.items.some((entry) => entry.id && entry.qty >= 1) ||
        pack.slots.some((options) => options.some((entry) => entry.id && entry.qty >= 1));
    const ready = hasItems && pack.price > 0;
    resultEmpty.hidden = ready;
    result.hidden = !ready;
    if (!ready) {
        return;
    }
    const value = valueCustomPack(pack, (contents, price) => valuation.bundle({ contains: contents }, price));
    verdict.innerHTML = verdictHtml(value);
    const dealText = dealCheckHtml();
    dealCheckLine.hidden = !dealText;
    dealCheckLine.innerHTML = dealText;

    contentsTable.innerHTML = partsTable(breakdownParts(value.parts, data, valuation));
    slotTables.innerHTML = value.slots
        .map((slot, index) => {
            const parts = slot.options.map((option, at) => ({
                ...breakdownParts([{ id: option.id, qty: option.qty }], data, valuation)[0],
                other: at !== slot.picked,
                note: at === slot.picked ? `✓ ${tHtml('customPack.picked')}` : '',
            }));
            return parts.length
                ? `<h3>${tHtml('customPack.slotOptions', { number: index + 1 })}</h3>
                   <div class="table-wrap"><table>${partsTable(parts)}</table></div>`
                : '';
        })
        .join('');
    hydrateItemIcons(result);
}

/** Keeps the pack in the URL and shows its verdict. */
function update() {
    setUrlParams(customPackParams(pack));
    renderResult();
}

startPage('custom-pack', {
    async init(loaded) {
        data = loaded;
        const { recompute } = mountValuationPage(data, {
            render: (next) => {
                valuation = next;
                saleRatios = packRatios();
                dealPoints = dealValues(data, next.fit);
                renderResult();
            },
        });
        pack = parseCustomPack(urlParam, data.items);
        if (pack.items.length === 0 && pack.slots.length === 0) {
            pack.items.push({ id: '', qty: 1 });
        }
        priceInput.value = pack.price || '';
        dealInput.value = pack.deal || '';
        renderBuilder();

        addItemButton.addEventListener('click', () => {
            pack.items.push({ id: '', qty: 1 });
            renderBuilder();
            focusLastPicker(itemsList);
        });
        addSlotButton.addEventListener('click', () => {
            pack.slots.push([{ id: '', qty: 1 }]);
            renderBuilder();
            focusLastPicker(slotsList.lastElementChild.children[1]);
        });
        priceInput.addEventListener('input', () => {
            pack.price = Math.max(0, Number(priceInput.value) || 0);
            update();
        });
        dealInput.addEventListener('input', () => {
            pack.deal = Math.max(0, Number(dealInput.value) || 0);
            update();
        });
        await recompute();
    },
    onLocaleChange() {
        renderBuilder();
        renderResult();
    },
});

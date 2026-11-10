/**
 * Event Shops: one tab per ticked event (and the VIP Shop, `?event=`) with the event's banner and when it runs, and
 * its slice of the weekly plan (planner.js): which event packs to buy, the coins they give, which shop offers to buy
 * with them (in unlock order, with Encounters and bonus tiers; offers can be locked to a count), and a step table of
 * how much spending more on the event still pays off. Shops whose coin no pack gives take an "Extra coins per week"
 * amount; dig events (`mines`, core/mine.js) take the pickaxes you own and the floor you've reached and get a verdict
 * card (dig this run or not), a floor table and the mine's rules.
 */
import { startPage } from '../../ui/page.js';
import '../../styles/pages/events.css';
import { mountValuationPage } from '../../ui/valuation-page.js';
import { getSettings, updateSettings } from '../../ui/settings.js';
import { withLoading } from '../../ui/loading.js';
import { setUrlParams, urlParam } from '../../ui/url.js';
import { itemDisplayText } from '../../ui/labels.js';
import { escapeHtml } from '../../ui/html.js';
import { t, localizedName } from '../../ui/i18n.js';
import { mineProgressFor } from '../../core/mine.js';
import { eventImageUrl, mountBanner } from '../../ui/event-banner.js';
import { ctx } from './state.js';
import {
    afterPaint,
    extraCurrencyOf,
    extraFor,
    outsideCurrency,
    maxSpendOf,
    mineRun,
    overridesKey,
    pageOverrides,
    selection,
} from './context.js';
import {
    chooseEvents,
    eventBanner,
    eventSummary,
    eventTabs,
    extraBanknotesField,
    extraBanknotesInput,
    extraCurrencyField,
    extraCurrencyInput,
    extraCurrencyLabel,
    mineFloorField,
    mineFloorInput,
    minePickaxesField,
    minePickaxesInput,
    planCard,
    promptCard,
    stepsCard,
} from './elements.js';
import { renderMine } from './mine.js';
import { renderPacks } from './packs.js';
import { renderLockNote, renderShop } from './shop.js';
import { renderSteps } from './steps.js';
import { renderSummary } from './summary.js';

function render() {
    const selected = selection();
    promptCard.hidden = Boolean(selected);
    planCard.hidden = !selected;
    const currencyId = outsideCurrency(selected);
    extraCurrencyField.hidden = !currencyId;
    if (currencyId) {
        extraCurrencyLabel.textContent = t('events.extraCurrency', {
            currency: itemDisplayText(ctx.data.items, currencyId),
        });
        // Diamonds come in thousands (an Encounter's in its price); an event's coins are counted one by one.
        extraCurrencyInput.step = String(
            currencyId === selected.shop.currency_item_id
                ? selected.shop.event_id
                    ? 1
                    : 1000
                : selected.shop.point_purchase.currency_cost,
        );
        extraCurrencyInput.value = String(extraCurrencyOf(selected));
    }
    extraBanknotesField.hidden = !(selected?.eventId && maxSpendOf(selected.eventId) > 0);
    extraBanknotesInput.value = String(extraFor(selected?.eventId));
    minePickaxesField.hidden = !selected?.mine;
    mineFloorField.hidden = !selected?.mine;
    if (selected?.mine) {
        const progress = mineProgressFor(getSettings().mineProgress?.[selected.mineId], mineRun(selected.eventId));
        minePickaxesInput.value = String(progress.owned);
        mineFloorInput.value = String(progress.floor);
        mineFloorInput.max = String(selected.mine.floors);
    }
    if (!selected) {
        stepsCard.hidden = true;
        return;
    }
    // The event's art and when it runs, as of today: is it on, and how long is left? (The VIP Shop has no event.)
    const event = selected.eventId ? ctx.data.events?.[selected.eventId] : null;
    mountBanner(
        eventBanner,
        ctx.data,
        selected.eventId,
        event && { image: event.image, name: localizedName(event.name) },
        render,
    );
    // The lock note's and the step table's solves block the page for seconds: what isn't cached yet shows a placeholder
    // and is worked out once the rest is painted (the note first, it is on top).
    ctx.renderToken++;
    renderLockNote({ compute: false });
    renderSummary(selected);
    renderPacks(selected);
    renderShop(selected);
    renderMine(selected);
    renderSteps(selected, { compute: false });
    afterPaint(() => {
        renderLockNote();
        afterPaint(() => renderSteps(selected));
    });
}

/**
 * The tabs: the ticked events, then the shops without event (VIP Shop). Keeps the tab shown while it's still
 * listed, else shows the first one.
 */
function populateSelect() {
    const entries = [];
    for (const id of getSettings().activeEvents.filter((eventId) => ctx.data.events?.[eventId])) {
        entries.push([`event:${id}`, ctx.data.events[id].name, eventImageUrl(ctx.data.events[id].image)]);
    }
    for (const [id, shop] of Object.entries(ctx.data.exchange_shops || {})) {
        if (!shop.event_id) {
            entries.push([`shop:${id}`, shop.name, null]);
        }
    }
    if (!entries.some(([key]) => key === ctx.selectedKey)) {
        ctx.selectedKey = entries[0]?.[0] ?? '';
    }
    eventTabs.innerHTML = entries
        .map(
            ([key, name, image]) =>
                `<button type="button" class="toggle-chip" data-tab="${escapeHtml(key)}" aria-pressed="${key === ctx.selectedKey}">${
                    image
                        ? `<img class="toggle-chip__thumb" src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />`
                        : ''
                }${escapeHtml(localizedName(name))}</button>`,
        )
        .join('');
}

/** With locks or extra currency the plan depends on the selection. */
function onEventChange() {
    if (
        Object.keys(getSettings().lockedOffers || {}).length > 0 ||
        Object.keys(getSettings().extraCurrency || {}).length > 0 ||
        overridesKey() !== ctx.valuationKey
    ) {
        void ctx.page.recompute();
    } else {
        void withLoading(render);
    }
}

startPage('events', {
    async init(loaded) {
        ctx.data = loaded;
        // The tab shown: `event:<id>` or `shop:<id>` (from the URL first, so a link opens the same event).
        ctx.selectedKey = urlParam('event') ?? '';
        ctx.page = mountValuationPage(ctx.data, {
            fields: ['budget', 'events', 'passes'],
            overrides: pageOverrides,
            prepare() {
                populateSelect();
                ctx.valuationKey = overridesKey();
            },
            render: (next) => {
                ctx.valuation = next;
                render();
            },
        });
        eventTabs.addEventListener('click', (event) => {
            const tab = event.target.closest('[data-tab]');
            if (!tab || tab.dataset.tab === ctx.selectedKey) {
                return;
            }
            ctx.selectedKey = tab.dataset.tab;
            for (const button of eventTabs.querySelectorAll('[data-tab]')) {
                button.setAttribute('aria-pressed', String(button.dataset.tab === ctx.selectedKey));
            }
            setUrlParams({ event: ctx.selectedKey });
            onEventChange();
        });
        chooseEvents.addEventListener('click', () => ctx.page.panel.open());
        extraCurrencyInput.addEventListener('change', () => {
            const selected = selection();
            const currencyId = outsideCurrency(selected);
            if (!currencyId) {
                return;
            }
            const amount = Math.max(0, Number(extraCurrencyInput.value) || 0);
            const extra = { ...getSettings().extraCurrency, [currencyId]: amount };
            if (amount === 0) {
                delete extra[currencyId];
            }
            updateSettings({ extraCurrency: extra });
        });
        extraBanknotesInput.addEventListener('change', () => {
            const eventId = selection()?.eventId;
            if (!eventId) {
                return;
            }
            const amount = Math.max(0, Number(extraBanknotesInput.value) || 0);
            const extraEventBanknotes = { ...getSettings().extraEventBanknotes, [eventId]: amount };
            if (amount === 0) {
                delete extraEventBanknotes[eventId];
            }
            updateSettings({ extraEventBanknotes });
        });
        // The mine's pickaxes owned and floor reached (the floor for the run it was entered in).
        const saveMineProgress = () => {
            const selected = selection();
            if (!selected?.mine) {
                return;
            }
            const whole = (input, max = Infinity) => Math.min(max, Math.max(0, Math.round(Number(input.value) || 0)));
            const mineProgress = {
                ...getSettings().mineProgress,
                [selected.mineId]: {
                    pickaxes: whole(minePickaxesInput),
                    floor: whole(mineFloorInput, selected.mine.floors),
                    run: mineRun(selected.eventId)?.start ?? null,
                },
            };
            updateSettings({ mineProgress });
        };
        minePickaxesInput.addEventListener('change', saveMineProgress);
        // The verdict card is re-rendered with the plan: its safety radios are wired here, once.
        eventSummary.addEventListener('change', (event) => {
            if (event.target.name === 'mine-safety') {
                updateSettings({ minePlanSafety: Number(event.target.value) });
            }
        });
        mineFloorInput.addEventListener('change', saveMineProgress);
        await ctx.page.recompute();
    },
    onLocaleChange() {
        populateSelect();
        render();
    },
});

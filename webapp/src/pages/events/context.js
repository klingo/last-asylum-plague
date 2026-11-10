/**
 * What the selected tab means: its event, shop and mine, the extra amounts the user entered and the
 * planner options they make.
 */
import { getSettings } from '../../ui/settings.js';
import { eventMaxSpend } from '../../core/catalog.js';
import { eventSelection, outsideCurrencyId } from '../../core/event-plan.js';
import { mineProgressFor } from '../../core/mine.js';
import { planningRun, gameDay } from '../../core/schedule.js';
import { nextPaint } from '../../ui/loading.js';
import { ctx } from './state.js';

/**
 * The selection: an event (`event:<id>`, with its shop and mine if any) or a shop without event (`shop:<id>`).
 */
function selection() {
    return eventSelection(ctx.data, ctx.selectedKey);
}

/** The currency the user enters an amount of for the selected shop (its coin, or the diamonds of its Encounters), or null. */
const outsideCurrency = (selected) => outsideCurrencyId(ctx.data.packages, selected?.shop);

/** Units per week of that currency from outside the packs (the user's input). */
const extraCurrencyOf = (selected) => getSettings().extraCurrency?.[outsideCurrency(selected)] || 0;

/** Extra Banknotes per week the user puts only into this event's packs (remembered per event). */
const extraFor = (eventId) => (eventId && getSettings().extraEventBanknotes?.[eventId]) || 0;

/** The run a mine's inputs are about (schedule.js `planningRun`). */
const mineRun = (eventId) => planningRun(ctx.data, eventId, gameDay(new Date()).day);

/**
 * Planner options of this page: for a mine, the days left of its run (daily pack limits, free pickaxes), the
 * pickaxes owned, the floor reached and how sure the planned pickaxes should be.
 */
function pageOverrides() {
    const selected = selection();
    const overrides = {};
    if (selected?.mine) {
        const run = mineRun(selected.eventId);
        if (run) {
            overrides.eventDaysLeft = { [selected.eventId]: run.days };
        }
        overrides.mineProgress = {
            [selected.mineId]: mineProgressFor(getSettings().mineProgress?.[selected.mineId], run),
        };
        overrides.mineSafety = getSettings().minePlanSafety;
    }
    return overrides;
}

/** The page overrides as a string, to tell whether the plan has to be solved again. */
const overridesKey = () => JSON.stringify(pageOverrides());

/** Most Banknotes the event's packages can take per week. */
const maxSpendOf = (eventId) =>
    eventMaxSpend(ctx.data.packages, eventId, { eventDaysLeft: pageOverrides().eventDaysLeft });

/**
 * Runs `work` once the page has been painted, unless a newer render has started since (`ctx.renderToken`): for what
 * blocks the page for seconds (the lock note's and the step table's solves), so the rest is on screen first.
 */
function afterPaint(work) {
    const token = ctx.renderToken;
    void nextPaint().then(() => {
        if (token === ctx.renderToken) {
            work();
        }
    });
}

/** The mine's part of the plan (`plan.mines`), or null. */
const minePlan = (mineId) => ctx.valuation.plan.mines.find((m) => m.mineId === mineId) ?? null;

export {
    afterPaint,
    extraCurrencyOf,
    extraFor,
    outsideCurrency,
    maxSpendOf,
    minePlan,
    mineRun,
    overridesKey,
    pageOverrides,
    selection,
};

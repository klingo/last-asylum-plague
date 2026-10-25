/**
 * The calendar's selection: the events and seasonal passes the recorded schedule shows running today (the game
 * day, from 02:00 UTC). The setup bar's "Follow the calendar" switch (on by default): every page applies it when it
 * loads, so the selection keeps up with the calendar. Selecting or unselecting an event or pass by hand turns it off
 * (valuation-panel.js), until the switch is turned on again.
 */
import { gameDay, scheduleRuns } from '../core/schedule.js';
import { packageFamilyId } from '../core/pack-data.js';
import { getSettings, updateSettings } from './settings.js';

/** Ids (events, pass families, tracks) the recorded calendar shows running today (the game day). */
function runningToday(data) {
    const today = gameDay(new Date()).day;
    return new Set(
        [...scheduleRuns(data)]
            .filter(([, { runs }]) => runs.some((run) => run.start <= today && today <= run.end))
            .map(([id]) => id),
    );
}

/**
 * What the calendar selects today: `{ activeEvents, seasonalPasses }`. In-game events (no packs, no shop) aren't
 * selectable; seasonal passes by package family.
 */
function calendarSelection(data) {
    const running = runningToday(data);
    const passFamilies = new Set(
        Object.entries(data.packages || {})
            .filter(([, pkg]) => pkg.seasonal)
            .map(([id, pkg]) => packageFamilyId(id, pkg)),
    );
    return {
        activeEvents: Object.entries(data.events || {})
            .filter(([id, event]) => event.category !== 'ingame_event' && running.has(id))
            .map(([id]) => id),
        seasonalPasses: [...passFamilies].filter((id) => running.has(id)),
    };
}

const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

/** While following the calendar: the selection set to today's (only if it changed). Call before a page computes. */
function followCalendar(data) {
    const settings = getSettings();
    if (!settings.followsCalendar) {
        return;
    }
    const selection = calendarSelection(data);
    if (
        !sameIds(settings.activeEvents, selection.activeEvents) ||
        !sameIds(settings.seasonalPasses, selection.seasonalPasses)
    ) {
        updateSettings(selection);
    }
}

export { runningToday, calendarSelection, followCalendar };

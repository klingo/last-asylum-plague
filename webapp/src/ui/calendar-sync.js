/**
 * The calendar's selection: the events and seasonal passes the schedule shows running today (the game
 * day, from 02:00 UTC; the rules are in core/schedule.js). The setup bar's "Follow the calendar" switch (on by
 * default): every page applies it when it loads, so the selection keeps up with the calendar. Selecting or
 * unselecting an event or pass by hand turns it off (valuation-panel.js), until the switch is turned on again.
 */
import { calendarSelection as selectionOn, gameDay, runningToday as runningOn } from '../core/schedule.js';
import { getSettings, updateSettings } from './settings.js';

const today = () => gameDay(new Date()).day;

/** Ids (events, pass families, tracks) the calendar shows running today (the game day): recorded, or a proven pattern. */
const runningToday = (data) => runningOn(data, today());

/** What the calendar selects today: `{ activeEvents, seasonalPasses }`. */
const calendarSelection = (data) => selectionOn(data, today());

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

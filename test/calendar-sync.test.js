import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarSelection, followCalendar } from '../webapp/src/ui/calendar-sync.js';
import { getSettings, updateSettings } from '../webapp/src/ui/settings.js';

// One event and one seasonal pass running now, one event that ended, one in-game event (not selectable).
const data = {
    events: {
        mine: { name: { en: 'Mine' } },
        old: { name: { en: 'Old' } },
        raid: { name: { en: 'Raid' }, category: 'ingame_event' },
    },
    packages: { gear_pass: { name: { en: 'Gear Pass' }, seasonal: true, price: 999 } },
    schedule: {
        mine: [{ start: '2000-01-01', end: '2100-12-31' }],
        gear_pass: [{ start: '2000-01-01', end: '2100-12-31' }],
        old: [{ start: '2000-01-01', end: '2000-01-07' }],
        raid: [{ start: '2000-01-01', end: '2100-12-31' }],
    },
};

test('calendar: what runs today is selected, in-game events are not', () => {
    assert.deepEqual(calendarSelection(data), { activeEvents: ['mine'], seasonalPasses: ['gear_pass'] });
});

test('calendar: while following, every page load applies the calendar; off, the selection is left alone', () => {
    updateSettings({ followsCalendar: false, activeEvents: ['old'], seasonalPasses: [] });
    followCalendar(data);
    assert.deepEqual(getSettings().activeEvents, ['old'], 'off: nothing changes');

    updateSettings({ followsCalendar: true });
    followCalendar(data);
    assert.deepEqual(getSettings().activeEvents, ['mine']);
    assert.deepEqual(getSettings().seasonalPasses, ['gear_pass']);

    // The selection drifted (e.g. a new run started since the last load): the next load puts it right again.
    updateSettings({ activeEvents: [] });
    followCalendar(data);
    assert.deepEqual(getSettings().activeEvents, ['mine']);
});

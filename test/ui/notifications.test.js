import { storage } from './env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { updateSettings } from '../../webapp/src/ui/settings.js';
import { STORAGE_KEYS } from '../../webapp/src/ui/storage.js';
import {
    checkScramble,
    checkSurvivalBattle,
    notificationsSupported,
    notifiesRotation,
    notifiesScramble,
    requestNotificationPermission,
} from '../../webapp/src/ui/notifications.js';

// Survival Battle in the shape of the data: 4-hour slots from Sunday 02:00 UTC.
const HOUR = 3600000;
const weekStart = Date.UTC(2026, 10, 1, 2);
const data = {
    events: { survival_battle: { name: { en: 'Survival Battle', de: 'Überlebenskampf' } } },
    event_rotations: {
        survival_battle: {
            week_starts: 'sunday',
            hours: 4,
            phases: [{ id: 'T', name: { en: 'Territory' } }],
            week: ['T', 'T', 'T'],
        },
    },
};
// The Royal City Scramble: Saturdays from 12:00 to 16:00 server time (14:00 to 18:00 UTC). Saturday 2026-11-14.
const scrambleData = {
    events: { royal_city_scramble: { name: { en: 'Royal City Scramble' } } },
    kingdom_war: {
        cycle_start: '2026-10-26',
        days: 6,
        weeks: [{ id: 'week_1', name: { en: 'Week 1' } }, null],
        royal_city_scramble: { event_id: 'royal_city_scramble', weekday: 'saturday', start_hour: 12, hours: 4 },
    },
};
const scrambleStart = Date.UTC(2026, 10, 14, 14);
const BODY = 'The new round of Survival Battle has begun! Complete the quests to enhance your strength!';

const shown = [];
class FakeNotification {
    static permission = 'granted';
    static requested = 0;
    static async requestPermission() {
        FakeNotification.requested += 1;
        return FakeNotification.permission;
    }
    constructor(title, options) {
        shown.push({ title, ...options });
        this.closed = false;
    }
    close() {
        this.closed = true;
    }
}
globalThis.Notification = FakeNotification;

beforeEach(() => {
    storage.clear();
    shown.length = 0;
    FakeNotification.permission = 'granted';
    FakeNotification.requested = 0;
    updateSettings({ notifySurvivalBattle: true, notifyScrambleSoon: true, notifyScrambleStart: true });
});

test('a round that just began is announced with the event name and the message', () => {
    checkSurvivalBattle(data, weekStart + 4 * HOUR + 20000);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].title, 'Survival Battle');
    assert.equal(shown[0].body, BODY);
    assert.equal(shown[0].tag, `survival_battle-${weekStart + 4 * HOUR}`);
});

test('the same round is announced once, however often it is checked or by whichever tab', () => {
    const now = weekStart + 4 * HOUR + 20000;
    checkSurvivalBattle(data, now);
    checkSurvivalBattle(data, now + 30000);
    assert.equal(shown.length, 1);
    assert.equal(JSON.parse(storage.get(STORAGE_KEYS.notified)).survival_battle, weekStart + 4 * HOUR);
    checkSurvivalBattle(data, weekStart + 8 * HOUR + 1000);
    assert.equal(shown.length, 2, 'the next round is announced again');
});

test('nothing for a round that began a while ago (a page opened late)', () => {
    checkSurvivalBattle(data, weekStart + 4 * HOUR + 10 * 60000);
    assert.equal(shown.length, 0);
    assert.equal(storage.has(STORAGE_KEYS.notified), false);
});

test('nothing while the setting is off or the browser has not allowed notifications', () => {
    const now = weekStart + 4 * HOUR + 20000;
    updateSettings({ notifySurvivalBattle: false });
    checkSurvivalBattle(data, now);
    updateSettings({ notifySurvivalBattle: true });
    FakeNotification.permission = 'denied';
    checkSurvivalBattle(data, now);
    FakeNotification.permission = 'default';
    checkSurvivalBattle(data, now);
    assert.equal(shown.length, 0);
});

test('without the rotation in the data nothing happens', () => {
    checkSurvivalBattle({ events: {}, event_rotations: {} }, weekStart + 20000);
    checkSurvivalBattle({}, weekStart + 20000);
    assert.equal(shown.length, 0);
});

test('a browser that refuses to show it does not break the page', () => {
    globalThis.Notification = class extends FakeNotification {
        constructor() {
            super();
            throw new TypeError('Illegal constructor');
        }
    };
    globalThis.Notification.permission = 'granted';
    try {
        assert.doesNotThrow(() => checkSurvivalBattle(data, weekStart + 4 * HOUR + 20000));
    } finally {
        globalThis.Notification = FakeNotification;
    }
});

test('permission is asked through the browser, and a browser without notifications says so', async () => {
    assert.equal(notificationsSupported(), true);
    assert.equal(await requestNotificationPermission(), 'granted');
    FakeNotification.permission = 'denied';
    assert.equal(await requestNotificationPermission(), 'denied');
    assert.equal(FakeNotification.requested, 2);
    const saved = globalThis.Notification;
    delete globalThis.Notification;
    try {
        assert.equal(notificationsSupported(), false);
        assert.equal(await requestNotificationPermission(), 'unsupported');
    } finally {
        globalThis.Notification = saved;
    }
});

test('the Today page marks Survival Battle with a bell only while a notification will come', () => {
    const rotation = { event_id: 'survival_battle' };
    assert.equal(notifiesRotation(rotation), true);
    assert.equal(notifiesRotation({ event_id: 'another_rotation' }), false, 'only Survival Battle has one');
    updateSettings({ notifySurvivalBattle: false });
    assert.equal(notifiesRotation(rotation), false, 'the setting is off');
    updateSettings({ notifySurvivalBattle: true });
    FakeNotification.permission = 'denied';
    assert.equal(notifiesRotation(rotation), false, 'the browser does not allow it');
});

test('the Royal City Scramble is announced an hour before it starts, once', () => {
    checkScramble(scrambleData, scrambleStart - HOUR + 20000);
    checkScramble(scrambleData, scrambleStart - HOUR + 50000);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].title, 'Royal City Scramble');
    assert.equal(shown[0].body, 'Royal City Scramble starts in 1 hour.');
    assert.equal(shown[0].tag, `royal_city_scramble_soon-${scrambleStart}`);
    assert.equal(JSON.parse(storage.get(STORAGE_KEYS.notified)).royal_city_scramble_soon, scrambleStart);
});

test('the Royal City Scramble is announced when it has started, once', () => {
    checkScramble(scrambleData, scrambleStart + 20000);
    checkScramble(scrambleData, scrambleStart + 50000);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].body, 'Royal City Scramble has started!');
    assert.equal(shown[0].tag, `royal_city_scramble_start-${scrambleStart}`);
    // The next Saturday is announced again.
    checkScramble(scrambleData, scrambleStart + 7 * 24 * HOUR - HOUR + 1000);
    assert.equal(shown.length, 2);
});

test('nothing for the Royal City Scramble at other times, or when it was a while ago', () => {
    checkScramble(scrambleData, scrambleStart - 2 * HOUR);
    checkScramble(scrambleData, scrambleStart - HOUR - 10 * 60000);
    checkScramble(scrambleData, scrambleStart - HOUR + 10 * 60000);
    checkScramble(scrambleData, scrambleStart + 10 * 60000);
    checkScramble(scrambleData, scrambleStart + 2 * HOUR);
    assert.equal(shown.length, 0);
});

test('each Royal City Scramble notification follows its own setting', () => {
    updateSettings({ notifyScrambleSoon: false });
    checkScramble(scrambleData, scrambleStart - HOUR + 20000);
    assert.equal(shown.length, 0, 'the hour before is off');
    checkScramble(scrambleData, scrambleStart + 20000);
    assert.equal(shown.length, 1, 'the start is on');
    updateSettings({ notifyScrambleStart: false, notifyScrambleSoon: true });
    checkScramble(scrambleData, scrambleStart - HOUR + 20000);
    assert.equal(shown.length, 2);
    checkScramble(scrambleData, scrambleStart + 7 * 24 * HOUR + 20000);
    assert.equal(shown.length, 2, 'the start is off');
});

test('no Royal City Scramble notification without the browser allowing it or without the data', () => {
    FakeNotification.permission = 'denied';
    checkScramble(scrambleData, scrambleStart + 20000);
    FakeNotification.permission = 'granted';
    checkScramble({ events: {} }, scrambleStart + 20000);
    assert.equal(shown.length, 0);
});

test('the Today page marks the Royal City Scramble with a bell while one of its notifications will come', () => {
    assert.equal(notifiesScramble(), true);
    updateSettings({ notifyScrambleSoon: false });
    assert.equal(notifiesScramble(), true, 'the start is still on');
    updateSettings({ notifyScrambleStart: false });
    assert.equal(notifiesScramble(), false, 'both are off');
    updateSettings({ notifyScrambleStart: true });
    FakeNotification.permission = 'denied';
    assert.equal(notifiesScramble(), false, 'the browser does not allow it');
});

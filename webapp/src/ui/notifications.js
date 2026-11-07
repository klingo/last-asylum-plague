/**
 * Browser notifications (the Notifications section of the Settings page). There is no server to push from, so a
 * notification only comes while a tab of the app is open: `startNotifications` (called by every page) checks every
 * half minute whether a new round of Survival Battle has just begun (core/schedule.js `freshSlot`) and, if the setting is
 * on and the browser allows it, shows one. The last one shown is saved, so several tabs and reloads don't repeat it.
 */
import { freshSlot } from '../core/schedule.js';
import { getSettings } from './settings.js';
import { STORAGE_KEYS, readJson, writeJson } from './storage.js';
import { localizedName, t } from './i18n.js';

const CHECK_MS = 30000;
// A round counts as "just begun" for this long: background tabs run their timers late (about once a minute).
const GRACE_MS = 3 * 60000;
const SURVIVAL_BATTLE = 'survival_battle';

/** Whether this browser can show notifications at all. */
function notificationsSupported() {
    return typeof Notification !== 'undefined';
}

/** Asks the user for permission (call it from a click); resolves 'granted', 'denied', 'default' or 'unsupported'. */
async function requestNotificationPermission() {
    if (!notificationsSupported()) {
        return 'unsupported';
    }
    try {
        return await Notification.requestPermission();
    } catch {
        return 'denied';
    }
}

/** Whether the Survival Battle notification is on and the browser allows it (so one will come). */
function survivalBattleNotificationsOn() {
    return (
        getSettings().notifySurvivalBattle === true && notificationsSupported() && Notification.permission === 'granted'
    );
}

/** Whether a notification is due for the event rotation `rotation` (the Today page marks its bars with a bell). */
function notifiesRotation(rotation) {
    return rotation.event_id === SURVIVAL_BATTLE && survivalBattleNotificationsOn();
}

/** Shows the Survival Battle notification if a round has just begun and none was shown for it yet. */
function checkSurvivalBattle(data, nowMs = Date.now()) {
    if (!survivalBattleNotificationsOn()) {
        return;
    }
    const rotation = data.event_rotations?.[SURVIVAL_BATTLE];
    const slot = rotation ? freshSlot(rotation, nowMs, GRACE_MS) : null;
    if (!slot) {
        return;
    }
    const notified = readJson(STORAGE_KEYS.notified);
    if (notified[SURVIVAL_BATTLE] === slot.start) {
        return;
    }
    writeJson(STORAGE_KEYS.notified, { ...notified, [SURVIVAL_BATTLE]: slot.start });
    try {
        const notification = new Notification(localizedName(data.events?.[SURVIVAL_BATTLE]?.name) || SURVIVAL_BATTLE, {
            body: t('settings.notifications.survivalBattleBody'),
            tag: `${SURVIVAL_BATTLE}-${slot.start}`,
        });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } catch {
        // The browser refused (some mobile browsers only show notifications from a service worker).
    }
}

/** Starts checking for notifications that are due (once, then every half minute). */
function startNotifications(data) {
    checkSurvivalBattle(data);
    window.setInterval(() => checkSurvivalBattle(data), CHECK_MS);
}

export {
    notificationsSupported,
    notifiesRotation,
    requestNotificationPermission,
    checkSurvivalBattle,
    startNotifications,
};

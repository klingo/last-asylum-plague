/**
 * Browser notifications (the Notifications section of the Settings page). There is no server to push from, so a
 * notification only comes while a tab of the app is open: `startNotifications` (called by every page) checks every
 * half minute whether a new round of Survival Battle has just begun (core/schedule.js `freshSlot`) and whether the
 * Royal City Scramble starts in an hour or has just started (core/kingdom-war.js `scrambleStatus`) and, if the setting
 * is on and the browser allows it, shows one. The last one shown is saved, so several tabs and reloads don't repeat it.
 */
import { freshSlot } from '../core/schedule.js';
import { scrambleStatus } from '../core/kingdom-war.js';
import { getSettings } from './settings.js';
import { STORAGE_KEYS, readJson, writeJson } from './storage.js';
import { localizedName, t } from './i18n.js';

const CHECK_MS = 30000;
// A round counts as "just begun" for this long: background tabs run their timers late (about once a minute).
const GRACE_MS = 3 * 60000;
// How long before the Royal City Scramble starts the "soon" notification comes.
const SCRAMBLE_SOON_MS = 60 * 60000;
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

/** Whether the browser allows notifications. */
function notificationsAllowed() {
    return notificationsSupported() && Notification.permission === 'granted';
}

/** Whether the Survival Battle notification is on and the browser allows it (so one will come). */
function survivalBattleNotificationsOn() {
    return getSettings().notifySurvivalBattle === true && notificationsAllowed();
}

/** Whether a notification is due for the event rotation `rotation` (the Today page marks its bars with a bell). */
function notifiesRotation(rotation) {
    return rotation.event_id === SURVIVAL_BATTLE && survivalBattleNotificationsOn();
}

/** Whether a Royal City Scramble notification (an hour before, or at the start) is on and allowed (Today's bell). */
function notifiesScramble() {
    const settings = getSettings();
    return (settings.notifyScrambleSoon === true || settings.notifyScrambleStart === true) && notificationsAllowed();
}

/** Shows a notification unless one was already shown for this `key` and `moment` (saved: other tabs and reloads too). */
function notifyOnce(key, moment, title, body) {
    const notified = readJson(STORAGE_KEYS.notified);
    if (notified[key] === moment) {
        return;
    }
    writeJson(STORAGE_KEYS.notified, { ...notified, [key]: moment });
    try {
        const notification = new Notification(title, { body, tag: `${key}-${moment}` });
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } catch {
        // The browser refused (some mobile browsers only show notifications from a service worker).
    }
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
    notifyOnce(
        SURVIVAL_BATTLE,
        slot.start,
        localizedName(data.events?.[SURVIVAL_BATTLE]?.name) || SURVIVAL_BATTLE,
        t('settings.notifications.survivalBattleBody'),
    );
}

/**
 * Shows the Royal City Scramble notifications that are on: one an hour before it starts (`notifyScrambleSoon`) and one
 * when it has just started (`notifyScrambleStart`), each once per scramble.
 */
function checkScramble(data, nowMs = Date.now()) {
    const war = data.kingdom_war;
    const settings = getSettings();
    if (!war || !notificationsAllowed()) {
        return;
    }
    const id = war.royal_city_scramble.event_id;
    const name = localizedName(data.events?.[id]?.name) || id;
    const { current, next } = scrambleStatus(war, nowMs);
    if (settings.notifyScrambleStart === true && current && nowMs - current.start <= GRACE_MS) {
        notifyOnce(`${id}_start`, current.start, name, t('settings.notifications.scrambleStartBody', { name }));
    }
    const due = next ? next.start - SCRAMBLE_SOON_MS : Infinity;
    if (settings.notifyScrambleSoon === true && nowMs >= due && nowMs - due <= GRACE_MS) {
        notifyOnce(`${id}_soon`, next.start, name, t('settings.notifications.scrambleSoonBody', { name }));
    }
}

/** Starts checking for notifications that are due (once, then every half minute). */
function startNotifications(data) {
    const check = () => {
        checkSurvivalBattle(data);
        checkScramble(data);
    };
    check();
    window.setInterval(check, CHECK_MS);
}

export {
    notificationsSupported,
    notifiesRotation,
    notifiesScramble,
    requestNotificationPermission,
    checkSurvivalBattle,
    checkScramble,
    startNotifications,
};

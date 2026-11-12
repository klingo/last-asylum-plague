/**
 * The browser's localStorage behind try/catch: it may be unavailable (private browsing, blocked) or hold something
 * else than we wrote. Reads then give the fallback, writes do nothing (the page still works, it just forgets).
 *
 * Every key the app uses is listed here (prefix `lapkc_`), so there is one place to look at what a browser holds.
 */

const STORAGE_KEYS = {
    locale: 'lapkc_locale', // 'en' | 'de'
    settings: 'lapkc_settings', // the shared settings (ui/settings.js)
    setupOpen: 'lapkc_setup_open', // '1' | '0': the setup bar's controls shown
    gearProgress: 'lapkc_gear_progress', // the Gear Upgrade Path's progress per guide and faction
    skillProgress: 'lapkc_skill_progress', // the Skill Upgrade Path's progress (steps done) and awakening levels, per faction
    lordSetup: 'lapkc_lord_setup', // the Lord Specialty's level, extra points, lord and builds
    notified: 'lapkc_notified', // the last notification shown per kind, so tabs and reloads don't repeat it
    githubToken: 'lapkc_github_token', // the personal access token of Settings > Admin (ui/github.js)
    sync: 'lapkc_sync', // the sync key and what this device last synced (ui/sync.js); never synced itself
};

// What earlier versions of the app saved (prefix `lasps_`): nothing reads it any more, so it is removed.
const LEGACY_KEYS = ['lasps_locale', 'lasps_valuation', 'lasps_setup_open', 'lasps_gear_progress', 'lasps_lord_setup'];

/** The text saved under `key`, or null (nothing saved or no storage). */
function readText(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

const writeListeners = new Set();

/** Calls `listener(key)` whenever a write changes what is saved under a key (the sync follows the entries so). */
function onWrite(listener) {
    writeListeners.add(listener);
}

/** Saves `text` under `key`. */
function writeText(key, text) {
    try {
        const changed = window.localStorage.getItem(key) !== text;
        window.localStorage.setItem(key, text);
        if (changed) {
            writeListeners.forEach((listener) => listener(key));
        }
    } catch {
        // Not saved.
    }
}

/** Removes what is saved under `key`. */
function removeText(key) {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // No storage: nothing to remove.
    }
}

/** The JSON object saved under `key`; `{}` when there is none or it isn't one. */
function readJson(key) {
    try {
        const value = JSON.parse(window.localStorage.getItem(key));
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

/** Saves `value` as JSON under `key`. */
function writeJson(key, value) {
    writeText(key, JSON.stringify(value));
}

/** Removes the keys earlier versions of the app saved. */
function removeLegacyKeys() {
    try {
        LEGACY_KEYS.forEach((key) => window.localStorage.removeItem(key));
    } catch {
        // No storage: nothing to remove.
    }
}

export { STORAGE_KEYS, onWrite, readText, writeText, removeText, readJson, writeJson, removeLegacyKeys };

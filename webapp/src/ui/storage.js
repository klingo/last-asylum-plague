/**
 * The browser's localStorage behind try/catch: it may be unavailable (private browsing, blocked) or hold something
 * else than we wrote. Reads then give the fallback, writes do nothing (the page still works, it just forgets).
 */

/** The text saved under `key`, or null (nothing saved or no storage). */
function readText(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** Saves `text` under `key`. */
function writeText(key, text) {
    try {
        window.localStorage.setItem(key, text);
    } catch {
        // Not saved.
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

export { readText, writeText, readJson, writeJson };

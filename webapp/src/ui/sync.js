/**
 * Keeps the user's settings and progress (the entries of `SYNCED_ENTRIES`, core/sync.js) the same on every device that
 * shares a sync key, through the sync server (worker/). The site is static, so this is its only backend; without a key
 * on the device nothing here does anything and every page works from localStorage alone.
 *
 * The device keeps `{ key, revs, dirty, synced }` under `STORAGE_KEYS.sync`: the key, the `rev` it last saw per entry,
 * the entries changed here since they were last pushed, and when it last synced. A page start pulls (`startSync`,
 * before the page reads its settings; skipped within a minute of the last sync, except on a reload by hand), a change
 * is pushed two seconds later (and when the page is hidden), and coming back to a tab pulls again and reloads the page
 * if another device changed something. The merge rules (a change made
 * here wins over the server's until it is pushed) are `planPull` / `planConnect` in core/sync.js.
 *
 * A second device joins with a six-digit pairing code (`createPairing` on the one that has the key, `connectWithCode`
 * on the other) or with the key itself. Every call tells its outcome as a code: 'ok', 'notFound' (nothing on the
 * server for it), 'rateLimited', 'network' (not reached) or 'error'.
 *
 * Whatever changes the state or the outcome of a call fires `syncchange` on the window, so the header's Sync button
 * (nav.js) can show `syncLevel`.
 */
import { SYNCED_ENTRIES, isEntryValue, isSyncKey, planConnect, planPull, syncKeyFromBytes } from '../core/sync.js';
import { STORAGE_KEYS, onWrite, readJson, readText, removeText, writeJson, writeText } from './storage.js';

// The sync server (worker/): its URL once it is deployed (empty: sync is off for everyone and the header hides the Sync button).
const SYNC_URL = 'https://last-asylum-plague-sync.klingo.workers.dev';

const REQUEST_TIMEOUT = 8000;
// A page start waits this long for the server at most, then shows what the device has.
const START_TIMEOUT = 2500;
// A page start within this long of the last successful sync (and with nothing to send) doesn't ask the server again.
const FRESH_MS = 60_000;
// A change is pushed this long after the last one.
const PUSH_DELAY = 2000;

const storageKey = (name) => STORAGE_KEYS[name];
const nameOfKey = new Map(SYNCED_ENTRIES.map((name) => [storageKey(name), name]));

// Set while the server's entries are written here, so they aren't pushed back as changes.
let applying = false;
let pushTimer = null;
let started = false;
// What the last call to the server came to (a code), for the Sync page.
let lastCode = null;

const announce = () => window.dispatchEvent(new Event('syncchange'));

function setLastCode(code) {
    lastCode = code;
    announce();
}

/** Whether this build has a sync server to talk to. */
const syncAvailable = () => SYNC_URL !== '';

/** The device's sync state, or null when it has no key. */
function readState() {
    const stored = readJson(STORAGE_KEYS.sync);
    if (!isSyncKey(stored.key)) {
        return null;
    }
    return {
        key: stored.key,
        revs: isEntryValue(stored.revs) ? stored.revs : {},
        dirty: Array.isArray(stored.dirty) ? stored.dirty.filter((name) => SYNCED_ENTRIES.includes(name)) : [],
        synced: Number.isFinite(stored.synced) ? stored.synced : null,
    };
}

function saveState(state) {
    writeJson(STORAGE_KEYS.sync, state);
    announce();
}

/** Takes sync off this device's state (the entries stay). */
function forgetState() {
    removeText(STORAGE_KEYS.sync);
    announce();
}

/** What this device saved of an entry: `{ text, value }`, or null when it saved none (or not an object). */
function readEntry(name) {
    const text = readText(storageKey(name));
    try {
        const value = JSON.parse(text);
        return isEntryValue(value) ? { text, value } : null;
    } catch {
        return null;
    }
}

/** The entries this device has saved. */
const savedEntries = () => SYNCED_ENTRIES.filter((name) => readEntry(name) !== null);

/** Saves the server's entries here (`apply`) and removes `remove`, without counting them as local changes. */
function applyEntries(apply, remove) {
    applying = true;
    try {
        for (const [name, value] of Object.entries(apply)) {
            writeText(storageKey(name), JSON.stringify(value));
        }
        remove.forEach((name) => removeText(storageKey(name)));
    } finally {
        applying = false;
    }
}

/** One call to the server: `{ code, data }`. */
async function call(
    path,
    { key = null, method = 'GET', body = null, keepalive = false, timeout = REQUEST_TIMEOUT } = {},
) {
    try {
        const response = await fetch(`${SYNC_URL}${path}`, {
            method,
            headers: {
                ...(key && { Authorization: `Bearer ${key}` }),
                ...(body && { 'Content-Type': 'application/json' }),
            },
            body: body && JSON.stringify(body),
            keepalive,
            signal: AbortSignal.timeout(timeout),
        });
        if (response.ok) {
            return { code: 'ok', data: await response.json() };
        }
        return { code: response.status === 404 ? 'notFound' : response.status === 429 ? 'rateLimited' : 'error' };
    } catch {
        return { code: 'network' };
    }
}

/**
 * Sends the entries changed here. `create` also makes the key's row when the server has none (turning sync on, or
 * uploading again after the server lost it); without it a missing row is 'notFound', so a key deleted elsewhere
 * isn't brought back by the next change.
 */
async function pushSync({ create = false, keepalive = false } = {}) {
    const state = readState();
    if (!state) {
        return 'off';
    }
    const sent = {};
    const entries = {};
    for (const name of state.dirty) {
        const entry = readEntry(name);
        if (entry) {
            sent[name] = entry.text;
            entries[name] = entry.value;
        }
    }
    const { code, data } = await call('/sync', { key: state.key, method: 'PUT', body: { entries, create }, keepalive });
    setLastCode(code);
    const fresh = readState();
    if (code !== 'ok' || !fresh) {
        return code;
    }
    // What changed again while the request was on its way stays to push.
    const dirty = fresh.dirty.filter((name) =>
        name in sent ? readText(storageKey(name)) !== sent[name] : !state.dirty.includes(name),
    );
    const revs = {
        ...fresh.revs,
        ...Object.fromEntries(Object.keys(sent).map((name) => [name, data.entries[name].rev])),
    };
    saveState({ ...fresh, revs, dirty, synced: Date.now() });
    return 'ok';
}

/**
 * Takes what other devices changed and sends what changed here. Gives `{ code, changed }`: `changed` is whether an
 * entry was replaced here, so the page shows stale values.
 */
async function pullSync(timeout = REQUEST_TIMEOUT) {
    const state = readState();
    if (!state) {
        return { code: 'off', changed: false };
    }
    const { code, data } = await call('/sync', { key: state.key, timeout });
    setLastCode(code);
    if (code !== 'ok') {
        return { code, changed: false };
    }
    const plan = planPull(state, data.entries);
    applyEntries(plan.apply, []);
    saveState({ ...state, revs: plan.revs, synced: Date.now() });
    const changed = Object.keys(plan.apply).length > 0;
    return { code: plan.push.length > 0 ? await pushSync() : 'ok', changed };
}

function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
        pushTimer = null;
        pushSync();
    }, PUSH_DELAY);
}

/** An entry was saved here: it counts as changed until it is pushed. */
function onEntryWrite(key) {
    const name = nameOfKey.get(key);
    const state = readState();
    if (applying || !name || !state) {
        return;
    }
    if (!state.dirty.includes(name)) {
        saveState({ ...state, dirty: [...state.dirty, name] });
    }
    schedulePush();
}

/** The page is being left or hidden: sends what is waiting (the request outlives the page). */
function flush() {
    if (readState()?.dirty.length > 0) {
        clearTimeout(pushTimer);
        pushSync({ keepalive: true });
    }
}

/** Back on the tab: another device may have changed something meanwhile. */
async function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
        flush();
    } else if ((await pullSync()).changed) {
        window.location.reload();
    }
}

/** Whether the page was reloaded by hand (F5): the user wants the latest data. */
const reloaded = () => performance.getEntriesByType('navigation')[0]?.type === 'reload';

/**
 * Starts the sync of a page: follows the entries from now on and pulls once, unless the device synced a moment ago
 * (clicking through pages doesn't ask the server every time; a reload by hand does). Call before the page reads its
 * entries.
 */
async function startSync() {
    if (!started) {
        started = true;
        onWrite(onEntryWrite);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', flush);
    }
    const state = readState();
    const fresh =
        state !== null && state.dirty.length === 0 && state.synced !== null && Date.now() - state.synced < FRESH_MS;
    if (!fresh || reloaded()) {
        await pullSync(START_TIMEOUT);
    }
}

/** What the Sync page shows: `{ on, key, synced (ms or null), code (of the last call, or null) }`. */
function syncStatus() {
    const state = readState();
    return { on: state !== null, key: state?.key ?? null, synced: state?.synced ?? null, code: lastCode };
}

/**
 * How the sync is doing, for the header's Sync button: 'off' (this device doesn't sync), 'good', 'warn' (changes
 * wait to be sent, or the server is busy or not reached: it catches up by itself) or 'bad' (the server has no data for
 * the key, or refused: it needs the user).
 */
function syncLevel() {
    const state = readState();
    if (!state) {
        return 'off';
    }
    if (lastCode === 'notFound' || lastCode === 'error') {
        return 'bad';
    }
    return lastCode === 'network' || lastCode === 'rateLimited' || state.dirty.length > 0 ? 'warn' : 'good';
}

const newKey = () => syncKeyFromBytes(crypto.getRandomValues(new Uint8Array(16)));

/** Turns sync on with a new key and uploads this device's entries. Left off when the server isn't reached. */
async function enableSync() {
    saveState({ key: newKey(), revs: {}, dirty: savedEntries(), synced: null });
    const code = await pushSync({ create: true });
    if (code !== 'ok') {
        forgetState();
    }
    return code;
}

/** Uploads this device's entries again (the server lost the key's data). */
function uploadAgain() {
    const state = readState();
    saveState({ ...state, dirty: savedEntries() });
    return pushSync({ create: true });
}

/** Turns sync on with `key` and takes the server's entries instead of this device's. */
async function connectWithKey(key) {
    const { code, data } = await call('/sync', { key });
    if (code !== 'ok') {
        return code;
    }
    const plan = planConnect(data.entries);
    applyEntries(plan.apply, plan.remove);
    saveState({ key, revs: plan.revs, dirty: [], synced: Date.now() });
    return 'ok';
}

/** Turns sync on with the key a pairing code stands for ('notFound': the code is wrong or has expired). */
async function connectWithCode(pairingCode) {
    const claim = await call('/pair/claim', { method: 'POST', body: { code: pairingCode } });
    return claim.code === 'ok' ? connectWithKey(claim.data.key) : claim.code;
}

/** A pairing code for another device: `{ code, pairing: { code, expiresIn (seconds) } }`. */
async function createPairing() {
    const { code, data } = await call('/pair', { key: readState().key, method: 'POST' });
    return { code, pairing: data };
}

/** Whether the pairing code is still waiting to be used: `{ code, pending }`. */
async function pairingPending() {
    const { code, data } = await call('/pair', { key: readState().key });
    return { code, pending: data?.pending === true };
}

/** Turns sync off on this device: its entries stay here and on the server. */
function disableSync() {
    clearTimeout(pushTimer);
    forgetState();
}

/** Deletes the key's data on the server and turns sync off here (other devices keep their key until they turn it off). */
async function deleteSync() {
    const { code } = await call('/sync', { key: readState().key, method: 'DELETE' });
    if (code === 'ok' || code === 'notFound') {
        disableSync();
        return 'ok';
    }
    return code;
}

/** A new key for the same data, for when the key got out: other devices have to connect again. */
async function rotateKey() {
    const old = readState();
    saveState({ key: newKey(), revs: {}, dirty: savedEntries(), synced: null });
    const code = await pushSync({ create: true });
    if (code !== 'ok') {
        saveState(old);
        return code;
    }
    // The old row would only wait to be cleaned up; failing to delete it now changes nothing.
    await call('/sync', { key: old.key, method: 'DELETE' });
    return 'ok';
}

export {
    syncAvailable,
    startSync,
    syncStatus,
    syncLevel,
    enableSync,
    uploadAgain,
    connectWithKey,
    connectWithCode,
    createPairing,
    pairingPending,
    disableSync,
    deleteSync,
    rotateKey,
    pullSync,
    pushSync,
};

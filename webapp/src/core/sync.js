/**
 * The rules of the cross-device sync, shared by the browser (ui/sync.js) and the Cloudflare Worker (worker/): which of
 * the browser's entries are synced, the shapes of the sync key and the pairing code, and how a pull is merged.
 *
 * An entry travels under the name of its `STORAGE_KEYS` property (`settings`, `gearProgress`, ...), as the JSON object
 * the browser saved, together with its `rev`: the server's time of its last change. A device remembers the `rev` it
 * last saw per entry (`revs`) and which entries it changed since it last pushed (`dirty`).
 */

// The entries that sync: the user's settings and progress. The language, the setup bar's state and the other
// per-device entries stay on the device.
const SYNCED_ENTRIES = ['settings', 'gearProgress', 'skillProgress', 'lordSetup'];

// The largest request the server takes (the four entries are a few KB).
const MAX_BODY_BYTES = 64 * 1024;

// A sync key is 128 random bits in base32 (26 characters); a pairing code is six digits.
const KEY_PATTERN = /^[a-z2-7]{26}$/;
const CODE_PATTERN = /^\d{6}$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A sync key from 16 random bytes. */
function syncKeyFromBytes(bytes) {
    let key = '';
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            key += BASE32[(buffer >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        key += BASE32[(buffer << (5 - bits)) & 31];
    }
    return key;
}

const isSyncKey = (text) => typeof text === 'string' && KEY_PATTERN.test(text);
const isPairingCode = (text) => typeof text === 'string' && CODE_PATTERN.test(text);

/** The key as typed or pasted (case, spaces and dashes don't matter), or null when it isn't one. */
function parseSyncKey(text) {
    const key = String(text).toLowerCase().replace(/[\s-]/g, '');
    return isSyncKey(key) ? key : null;
}

/** The code as typed or pasted (spaces and dashes don't matter), or null when it isn't one. */
function parsePairingCode(text) {
    const code = String(text).replace(/[\s-]/g, '');
    return isPairingCode(code) ? code : null;
}

/** The key in groups of four to read and copy: `abcd-efgh-...`. */
const formatSyncKey = (key) => key.match(/.{1,4}/g).join('-');

/** The code in two groups of three: `482 913`. */
const formatPairingCode = (code) => `${code.slice(0, 3)} ${code.slice(3)}`;

/** Whether `value` is something an entry may hold: a JSON object (not an array). */
const isEntryValue = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The entries of a request body (`{ name: value }`) when every name is a synced one and every value an object, else
 * null.
 */
function validEntries(entries) {
    if (!isEntryValue(entries)) {
        return null;
    }
    const names = Object.keys(entries);
    return names.every((name) => SYNCED_ENTRIES.includes(name) && isEntryValue(entries[name])) ? entries : null;
}

/**
 * What a pull from the server does on a device: `remote` is the server's `{ name: { value, rev } }`, `state` the
 * device's `{ revs, dirty }`. Returns `apply` (`{ name: value }`: entries the server has newer, now to be saved
 * here), the device's new `revs` and `push` (the entries changed here, which win over the server's: a change made
 * offline isn't lost to an older change on another device).
 */
function planPull(state, remote) {
    const dirty = new Set(state.dirty);
    const apply = {};
    const revs = { ...state.revs };
    for (const name of SYNCED_ENTRIES) {
        const entry = remote[name];
        if (isEntryValue(entry?.value) && !dirty.has(name) && entry.rev > (revs[name] ?? 0)) {
            apply[name] = entry.value;
            revs[name] = entry.rev;
        }
    }
    return { apply, revs, push: SYNCED_ENTRIES.filter((name) => dirty.has(name)) };
}

/**
 * What connecting to a key does on a device: it takes the server's entries as they are. `apply` are the entries to
 * save, `remove` the synced entries the server has none of (this device's own are dropped), `revs` the new ones.
 */
function planConnect(remote) {
    const apply = {};
    const revs = {};
    for (const name of SYNCED_ENTRIES) {
        if (isEntryValue(remote[name]?.value)) {
            apply[name] = remote[name].value;
            revs[name] = remote[name].rev;
        }
    }
    return { apply, remove: SYNCED_ENTRIES.filter((name) => !(name in apply)), revs };
}

export {
    SYNCED_ENTRIES,
    MAX_BODY_BYTES,
    syncKeyFromBytes,
    isSyncKey,
    isPairingCode,
    parseSyncKey,
    parsePairingCode,
    formatSyncKey,
    formatPairingCode,
    isEntryValue,
    validEntries,
    planPull,
    planConnect,
};

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SYNCED_ENTRIES,
    formatPairingCode,
    formatSyncKey,
    isEntryValue,
    isPairingCode,
    isSyncKey,
    parsePairingCode,
    parseSyncKey,
    planConnect,
    planPull,
    syncKeyFromBytes,
    validEntries,
} from '../../webapp/src/core/sync.js';
import { STORAGE_KEYS } from '../../webapp/src/ui/storage.js';

test('every synced entry is one of the storage keys, and the sync state itself is not synced', () => {
    assert.ok(SYNCED_ENTRIES.every((name) => name in STORAGE_KEYS));
    assert.ok(!SYNCED_ENTRIES.includes('sync'));
});

test('a sync key is 26 base32 characters from 16 bytes', () => {
    assert.equal(syncKeyFromBytes(new Uint8Array(16)), 'a'.repeat(26));
    // 25 groups of five 1-bits, then the last three bits padded with two zeros: 0b11100 = '4'.
    assert.equal(syncKeyFromBytes(new Uint8Array(16).fill(255)), `${'7'.repeat(25)}4`);
    const key = syncKeyFromBytes(Uint8Array.from({ length: 16 }, (_, i) => i * 17));
    assert.ok(isSyncKey(key));
    assert.notEqual(key, syncKeyFromBytes(new Uint8Array(16)));
});

test('only 26 lower-case base32 characters are a sync key, only six digits a pairing code', () => {
    assert.equal(isSyncKey('a'.repeat(26)), true);
    assert.equal(isSyncKey('a'.repeat(25)), false);
    assert.equal(isSyncKey('A'.repeat(26)), false);
    assert.equal(isSyncKey('1'.repeat(26)), false);
    assert.equal(isSyncKey(null), false);
    assert.equal(isPairingCode('012345'), true);
    assert.equal(isPairingCode('12345'), false);
    assert.equal(isPairingCode('12345a'), false);
    assert.equal(isPairingCode(123456), false);
});

test('a typed key or code may have spaces, dashes and capitals', () => {
    const key = `${'abcdefghijklmnopqrstuvwxyz'.slice(0, 20)}234567`;
    assert.equal(parseSyncKey(formatSyncKey(key).toUpperCase()), key);
    assert.equal(parseSyncKey(` ${key} `), key);
    assert.equal(parseSyncKey('too short'), null);
    assert.equal(parsePairingCode('482 913'), '482913');
    assert.equal(parsePairingCode('482-913'), '482913');
    assert.equal(parsePairingCode('4829'), null);
    assert.equal(parsePairingCode(''), null);
});

test('the key is shown in groups of four and the code in two of three', () => {
    assert.equal(formatSyncKey('abcdefghijklmnopqrstuvwxyz'), 'abcd-efgh-ijkl-mnop-qrst-uvwx-yz');
    assert.equal(formatPairingCode('482913'), '482 913');
});

test('an entry holds an object, not an array, a number or null', () => {
    assert.equal(isEntryValue({}), true);
    assert.equal(isEntryValue([]), false);
    assert.equal(isEntryValue(null), false);
    assert.equal(isEntryValue('x'), false);
});

test('a request body is valid when every entry is a synced name with an object', () => {
    const entries = { settings: { budget: 5 }, gearProgress: {} };
    assert.equal(validEntries(entries), entries);
    assert.deepEqual(validEntries({}), {});
    assert.equal(validEntries({ locale: {} }), null);
    assert.equal(validEntries({ settings: [] }), null);
    assert.equal(validEntries({ settings: 'x' }), null);
    assert.equal(validEntries(null), null);
    assert.equal(validEntries(undefined), null);
});

test('a pull takes the entries the server has newer, and keeps those changed here', () => {
    const state = { revs: { settings: 10, gearProgress: 10, lordSetup: 10 }, dirty: ['lordSetup'] };
    const remote = {
        settings: { value: { budget: 1 }, rev: 20 },
        gearProgress: { value: { a: 1 }, rev: 10 },
        skillProgress: { value: { done: 3 }, rev: 5 },
        lordSetup: { value: { level: 2 }, rev: 30 },
    };
    const plan = planPull(state, remote);
    assert.deepEqual(plan.apply, { settings: { budget: 1 }, skillProgress: { done: 3 } });
    assert.deepEqual(plan.revs, { settings: 20, gearProgress: 10, skillProgress: 5, lordSetup: 10 });
    assert.deepEqual(plan.push, ['lordSetup']);
});

test('a pull ignores unknown names and entries that are no objects', () => {
    const plan = planPull({ revs: {}, dirty: [] }, { locale: { value: {}, rev: 1 }, settings: { value: 'x', rev: 1 } });
    assert.deepEqual(plan.apply, {});
    assert.deepEqual(plan.revs, {});
    assert.deepEqual(plan.push, []);
});

test('connecting takes the server entries and drops the others from the device', () => {
    const plan = planConnect({
        settings: { value: { budget: 1 }, rev: 7 },
        lordSetup: { value: 5, rev: 8 },
        locale: { value: {}, rev: 9 },
    });
    assert.deepEqual(plan.apply, { settings: { budget: 1 } });
    assert.deepEqual(plan.revs, { settings: 7 });
    assert.deepEqual(plan.remove, ['gearProgress', 'skillProgress', 'lordSetup']);
});

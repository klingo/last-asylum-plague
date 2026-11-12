import { storage } from './env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    STORAGE_KEYS,
    onWrite,
    readJson,
    readText,
    removeLegacyKeys,
    removeText,
    writeJson,
    writeText,
} from '../../webapp/src/ui/storage.js';

beforeEach(() => storage.clear());

test('text is saved and read back, nothing saved gives null', () => {
    assert.equal(readText('k'), null);
    writeText('k', 'v');
    assert.equal(readText('k'), 'v');
});

test('a write that changes the saved text is told to the listeners, one that does not is not', () => {
    const told = [];
    onWrite((key) => told.push(key));
    writeText('watched', 'a');
    writeText('watched', 'a');
    writeJson('watched', { b: 1 });
    writeJson('watched', { b: 1 });
    assert.deepEqual(told, ['watched', 'watched']);
});

test('removed text is gone', () => {
    writeText('k', 'v');
    removeText('k');
    assert.equal(readText('k'), null);
    assert.doesNotThrow(() => removeText('missing'));
});

test('JSON objects are saved and read back', () => {
    writeJson('k', { a: [1, 2] });
    assert.deepEqual(readJson('k'), { a: [1, 2] });
});

test('nothing, broken text or something that is no object read as an empty object', () => {
    assert.deepEqual(readJson('missing'), {});
    storage.set('broken', '{not json');
    assert.deepEqual(readJson('broken'), {});
    storage.set('number', '5');
    assert.deepEqual(readJson('number'), {});
    storage.set('null', 'null');
    assert.deepEqual(readJson('null'), {});
});

test('without a usable localStorage reads give the fallback and writes do nothing', () => {
    const saved = globalThis.window.localStorage;
    const blocked = () => {
        throw new Error('blocked');
    };
    globalThis.window.localStorage = { getItem: blocked, setItem: blocked };
    try {
        assert.equal(readText('k'), null);
        assert.deepEqual(readJson('k'), {});
        assert.doesNotThrow(() => writeText('k', 'v'));
        assert.doesNotThrow(() => removeText('k'));
    } finally {
        globalThis.window.localStorage = saved;
    }
});

test("every key is the app's own: one prefix, no two the same", () => {
    const keys = Object.values(STORAGE_KEYS);
    assert.ok(keys.every((key) => key.startsWith('lapkc_')));
    assert.equal(new Set(keys).size, keys.length);
});

test('keys of earlier versions are removed, the current ones stay', () => {
    storage.set('lasps_valuation', '{}');
    storage.set('lasps_locale', 'de');
    storage.set(STORAGE_KEYS.settings, '{}');
    storage.set('somebody_elses_key', 'x');
    removeLegacyKeys();
    assert.deepEqual([...storage.keys()].sort(), ['somebody_elses_key', STORAGE_KEYS.settings].sort());
});

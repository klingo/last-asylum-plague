import { storage } from './env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readJson, readText, writeJson, writeText } from '../../webapp/src/ui/storage.js';

beforeEach(() => storage.clear());

test('text is saved and read back, nothing saved gives null', () => {
    assert.equal(readText('k'), null);
    writeText('k', 'v');
    assert.equal(readText('k'), 'v');
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
    } finally {
        globalThis.window.localStorage = saved;
    }
});

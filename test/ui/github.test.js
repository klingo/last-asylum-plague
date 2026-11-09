import { storage } from './env.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkToken, clearToken, dispatchRecordRun, readToken, saveToken } from '../../webapp/src/ui/github.js';
import { STORAGE_KEYS } from '../../webapp/src/ui/storage.js';

const realFetch = globalThis.fetch;
let calls;

// Answers every request with `status` (or fails like a lost connection with `status` null) and records it.
function answer(status) {
    calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        if (status === null) {
            throw new TypeError('Failed to fetch');
        }
        return { ok: status >= 200 && status < 300, status };
    };
}

beforeEach(() => storage.clear());
afterEach(() => {
    globalThis.fetch = realFetch;
});

test('the token is saved, read back and cleared', () => {
    assert.equal(readToken(), null);
    saveToken('github_pat_abc');
    assert.equal(storage.get(STORAGE_KEYS.githubToken), 'github_pat_abc');
    assert.equal(readToken(), 'github_pat_abc');
    clearToken();
    assert.equal(readToken(), null);
    assert.equal(storage.has(STORAGE_KEYS.githubToken), false);
});

test('checking a token asks for the record-run workflow with the token', async () => {
    answer(200);
    assert.equal(await checkToken('t0k'), 'ok');
    assert.equal(calls.length, 1);
    assert.equal(
        calls[0].url,
        'https://api.github.com/repos/klingo/last-asylum-plague/actions/workflows/record-run.yml',
    );
    assert.equal(calls[0].init.headers.Authorization, 'Bearer t0k');
    assert.equal(calls[0].init.method, undefined, 'a plain GET');
});

test('the answer is told as a code: invalid, no access, other error, no connection', async () => {
    answer(401);
    assert.equal(await checkToken('t'), 'invalid');
    answer(403);
    assert.equal(await checkToken('t'), 'noAccess');
    answer(404);
    assert.equal(await checkToken('t'), 'noAccess');
    answer(422);
    assert.equal(await checkToken('t'), 'error');
    answer(null);
    assert.equal(await checkToken('t'), 'network');
});

test('a run is dispatched on master with the ids, start and days as text inputs', async () => {
    answer(204);
    const result = await dispatchRecordRun('t0k', { ids: ['bazaar', 'gear_pass'], start: '2026-11-09', days: 7 });
    assert.equal(result, 'ok');
    const { url, init } = calls[0];
    assert.ok(url.endsWith('/actions/workflows/record-run.yml/dispatches'));
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), {
        ref: 'master',
        inputs: { ids: 'bazaar gear_pass', start: '2026-11-09', days: '7' },
    });
});

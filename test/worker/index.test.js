import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanUp, handle } from '../../worker/src/index.js';
import { createD1 } from './d1.js';

const KEY = `${'abcdefghijklmnopqrstuvwxyz'.slice(0, 20)}234567`;
const OTHER_KEY = 'z'.repeat(26);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = Date.UTC(2026, 10, 12, 12);

let d1;
let env;

beforeEach(() => {
    d1 = createD1();
    env = { DB: d1, ALLOWED_ORIGINS: 'https://klingo.github.io' };
});

/** One request to the worker: `{ status, body, headers }`. */
async function call(method, path, { key = KEY, body, ip = '1.1.1.1', origin, now = NOW, text } = {}) {
    const headers = { 'CF-Connecting-IP': ip };
    if (key) {
        headers.Authorization = `Bearer ${key}`;
    }
    if (origin) {
        headers.Origin = origin;
    }
    const request = new Request(`https://sync.test${path}`, {
        method,
        headers,
        body: text ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const response = await handle(request, env, now);
    const raw = await response.text();
    return { status: response.status, body: raw ? JSON.parse(raw) : null, headers: response.headers };
}

const create = (entries = {}, options = {}) => call('PUT', '/sync', { body: { entries, create: true }, ...options });

test('a request needs a well-formed key and a known route', async () => {
    assert.equal((await call('GET', '/sync', { key: null })).status, 401);
    assert.equal((await call('GET', '/sync', { key: 'short' })).status, 401);
    assert.equal((await call('GET', '/nowhere')).status, 404);
    assert.equal((await call('PATCH', '/sync')).status, 404);
});

test('a key without a row is unknown until a request creates it', async () => {
    assert.equal((await call('GET', '/sync')).status, 404);
    assert.equal((await call('PUT', '/sync', { body: { entries: { settings: {} } } })).status, 404);
    assert.equal((await create({ settings: { budget: 5 } })).status, 200);
    const { status, body } = await call('GET', '/sync');
    assert.equal(status, 200);
    assert.deepEqual(body.entries.settings, { value: { budget: 5 }, rev: NOW });
});

test('a PUT merges its entries into the others, each with a newer rev', async () => {
    await create({ settings: { budget: 5 }, gearProgress: { a: 1 } });
    const later = await call('PUT', '/sync', { body: { entries: { settings: { budget: 9 } } }, now: NOW + 1000 });
    assert.deepEqual(later.body.entries.settings, { value: { budget: 9 }, rev: NOW + 1000 });
    assert.deepEqual(later.body.entries.gearProgress, { value: { a: 1 }, rev: NOW });
    // The same millisecond again still gives a higher rev.
    const same = await call('PUT', '/sync', { body: { entries: { settings: { budget: 10 } } }, now: NOW + 1000 });
    assert.equal(same.body.entries.settings.rev, NOW + 1001);
});

test('the database holds the key only as its hash', async () => {
    await create({ settings: {} });
    const rows = d1.db.prepare('SELECT id FROM sync').all();
    assert.equal(rows.length, 1);
    assert.match(rows[0].id, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(rows).includes(KEY));
});

test('entries must be synced names holding objects, in a body that is not too large', async () => {
    const put = (entries) => call('PUT', '/sync', { body: { entries, create: true } });
    assert.equal((await put({ locale: {} })).status, 400);
    assert.equal((await put({ settings: [] })).status, 400);
    assert.equal((await put({ settings: 'x' })).status, 400);
    assert.equal((await put(null)).status, 400);
    assert.equal((await call('PUT', '/sync', { text: '{not json' })).status, 400);
    const big = { settings: { filler: 'x'.repeat(70 * 1024) } };
    assert.equal((await put(big)).status, 400);
    assert.equal((await call('GET', '/sync')).status, 404, 'nothing was stored');
});

test('another key sees nothing of the first', async () => {
    await create({ settings: { budget: 5 } });
    assert.equal((await call('GET', '/sync', { key: OTHER_KEY })).status, 404);
});

test('deleting removes the row and its pairing code', async () => {
    await create({ settings: {} });
    await call('POST', '/pair');
    assert.equal((await call('DELETE', '/sync')).status, 200);
    assert.equal((await call('GET', '/sync')).status, 404);
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM pairing').get().n, 0);
});

test('a read marks the row as used only once a day', async () => {
    await create({ settings: {} });
    const lastSeen = () => d1.db.prepare('SELECT last_seen FROM sync').get().last_seen;
    await call('GET', '/sync', { now: NOW + 1000 });
    assert.equal(lastSeen(), NOW);
    await call('GET', '/sync', { now: NOW + DAY + 1000 });
    assert.equal(lastSeen(), NOW + DAY + 1000);
});

test('a pairing code hands the key over once', async () => {
    await create({ settings: {} });
    const made = await call('POST', '/pair');
    assert.equal(made.status, 200);
    assert.match(made.body.code, /^\d{6}$/);
    assert.equal(made.body.expiresIn, 600);
    assert.deepEqual((await call('GET', '/pair')).body, { pending: true });

    const claim = await call('POST', '/pair/claim', { key: null, ip: '2.2.2.2', body: { code: made.body.code } });
    assert.deepEqual(claim.body, { key: KEY });
    assert.deepEqual((await call('GET', '/pair')).body, { pending: false });
    const again = await call('POST', '/pair/claim', { key: null, ip: '2.2.2.2', body: { code: made.body.code } });
    assert.equal(again.status, 404);
});

test('a new code replaces the earlier one, and a pairing needs an existing key', async () => {
    assert.equal((await call('POST', '/pair')).status, 404);
    await create({ settings: {} });
    const first = (await call('POST', '/pair')).body.code;
    const second = (await call('POST', '/pair')).body.code;
    assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM pairing').get().n, 1);
    if (first !== second) {
        const claim = await call('POST', '/pair/claim', { key: null, body: { code: first } });
        assert.equal(claim.status, 404);
    }
});

test('a code runs out after ten minutes', async () => {
    await create({ settings: {} });
    const { code } = (await call('POST', '/pair')).body;
    assert.deepEqual((await call('GET', '/pair', { now: NOW + 10 * MINUTE + 1 })).body, { pending: false });
    const late = await call('POST', '/pair/claim', { key: null, body: { code }, now: NOW + 10 * MINUTE + 1 });
    assert.equal(late.status, 404);
    const early = await call('POST', '/pair/claim', { key: null, body: { code }, now: NOW + 9 * MINUTE });
    assert.equal(early.status, 200);
});

test('a claim needs a six-digit code', async () => {
    assert.equal((await call('POST', '/pair/claim', { key: null, body: { code: '12ab' } })).status, 400);
    assert.equal((await call('POST', '/pair/claim', { key: null, body: {} })).status, 400);
    assert.equal((await call('POST', '/pair/claim', { key: null, text: 'nope' })).status, 400);
    assert.equal((await call('POST', '/pair/claim', { key: null, body: { code: '000000' } })).status, 404);
});

test('five claims per ten minutes and IP, right or wrong, then none', async () => {
    await create({ settings: {} });
    const { code } = (await call('POST', '/pair')).body;
    const guess = (options = {}) =>
        call('POST', '/pair/claim', { key: null, ip: '9.9.9.9', body: { code: '000000' }, ...options });
    for (let i = 0; i < 5; i++) {
        assert.notEqual((await guess()).status, 429);
    }
    assert.equal((await guess()).status, 429);
    // Even the right code is refused from that IP now; another IP is not affected.
    assert.equal((await guess({ body: { code } })).status, 429);
    assert.equal((await guess({ ip: '8.8.8.8', body: { code } })).status, 200);
    // After the window the IP may try again.
    assert.notEqual((await guess({ now: NOW + 10 * MINUTE + 1 })).status, 429);
});

test('ten new keys per hour and IP', async () => {
    const make = (letter, options) => create({}, { key: letter.repeat(26), ...options });
    for (const letter of 'abcdefghij') {
        assert.equal((await make(letter)).status, 200);
    }
    assert.equal((await make('k')).status, 429);
    assert.equal((await make('k', { ip: '3.3.3.3' })).status, 200);
    assert.equal((await make('l', { now: NOW + 60 * MINUTE + 1 })).status, 200);
    // Changing a key that exists is not creating one.
    assert.equal((await call('PUT', '/sync', { key: 'a'.repeat(26), body: { entries: {} } })).status, 200);
});

test('only the deployed site and localhost may call', async () => {
    assert.equal((await call('GET', '/sync', { origin: 'https://evil.example' })).status, 403);
    const site = await call('GET', '/sync', { origin: 'https://klingo.github.io' });
    assert.equal(site.status, 404);
    assert.equal(site.headers.get('Access-Control-Allow-Origin'), 'https://klingo.github.io');
    assert.equal(site.headers.get('Cache-Control'), 'no-store');
    assert.equal((await call('GET', '/sync', { origin: 'http://localhost:5173' })).status, 404);
    assert.equal((await call('GET', '/sync', { origin: 'http://127.0.0.1:8787' })).status, 404);
    assert.equal((await call('GET', '/sync', { origin: 'http://localhost.evil.example' })).status, 403);
});

test('the preflight allows the methods and headers the site uses', async () => {
    const response = await call('OPTIONS', '/sync', { origin: 'https://klingo.github.io', key: null });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('Access-Control-Allow-Methods'), /PUT/);
    assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/);
    assert.equal((await call('OPTIONS', '/sync', { origin: 'https://evil.example', key: null })).status, 403);
});

test('the rate limiter of the platform turns requests away', async () => {
    env.LIMITER = { limit: async () => ({ success: false }) };
    assert.equal((await call('GET', '/sync')).status, 429);
    env.LIMITER = { limit: async ({ key }) => ({ success: key !== '1.1.1.1' }) };
    assert.equal((await call('GET', '/sync')).status, 429);
    assert.equal((await call('GET', '/sync', { ip: '4.4.4.4' })).status, 404);
});

test('the clean-up drops keys unused for 180 days, expired codes and old counters', async () => {
    await create({ settings: {} });
    await create({ settings: {} }, { key: OTHER_KEY, now: NOW + 100 * DAY });
    await call('POST', '/pair', { now: NOW + 100 * DAY });
    await call('POST', '/pair/claim', { key: null, body: { code: '000000' }, now: NOW });
    await cleanUp(d1, NOW + 181 * DAY);
    const count = (table) => d1.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    assert.equal(count('sync'), 1, 'the key used 81 days ago stays');
    assert.equal(count('pairing'), 0);
    assert.equal(count('limits'), 0);
    await cleanUp(d1, NOW + 281 * DAY);
    assert.equal(count('sync'), 0);
});

test('the worker answers through fetch, turns a failure into a 500 and cleans up when scheduled', async () => {
    const response = await worker.fetch(
        new Request('https://sync.test/sync', { headers: { Authorization: `Bearer ${KEY}` } }),
        env,
    );
    assert.equal(response.status, 404);

    const error = console.error;
    console.error = () => {};
    try {
        const broken = await worker.fetch(
            new Request('https://sync.test/sync', { headers: { Authorization: `Bearer ${KEY}` } }),
            { DB: null },
        );
        assert.equal(broken.status, 500);
    } finally {
        console.error = error;
    }

    const waiting = [];
    worker.scheduled({}, env, { waitUntil: (promise) => waiting.push(promise) });
    assert.equal(waiting.length, 1);
    await waiting[0];
});

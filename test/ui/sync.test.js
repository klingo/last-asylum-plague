import { storage } from './env.js';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../worker/src/index.js';
import { createD1 } from '../worker/d1.js';
import { STORAGE_KEYS, readJson, readText, writeJson } from '../../webapp/src/ui/storage.js';
import {
    connectWithCode,
    connectWithKey,
    createPairing,
    deleteSync,
    disableSync,
    enableSync,
    pairingPending,
    pullSync,
    pushSync,
    rotateKey,
    startSync,
    syncAvailable,
    syncLevel,
    syncStatus,
    uploadAgain,
} from '../../webapp/src/ui/sync.js';

// The browser's events, kept so a test can fire them; `startSync` registers its handlers once per process.
const handlers = {};
globalThis.document.addEventListener = (type, handler) => {
    handlers[`document:${type}`] = handler;
};
globalThis.window.addEventListener = (type, handler) => {
    handlers[`window:${type}`] = handler;
};
// The events the sync fires for the header's Sync button.
let announced = 0;
globalThis.window.dispatchEvent = (event) => {
    if (event.type === 'syncchange') {
        announced++;
    }
};
let reloads = 0;
globalThis.window.location.reload = () => {
    reloads++;
};

const realFetch = globalThis.fetch;
// The devices: the browser's storage of the one in use is `storage`; the others wait here.
const parked = new Map();
let current = 'A';
let d1;
let online;

/** Every call of the client goes to the real worker code on an in-memory database (or fails when offline). */
function connectToServer() {
    d1 = createD1();
    online = true;
    globalThis.fetch = async (url, init) => {
        if (!online) {
            throw new TypeError('Failed to fetch');
        }
        return handle(new Request(new URL(url, 'https://sync.test'), init), { DB: d1 });
    };
}

/** Switches to another device: its own localStorage. */
function useDevice(name) {
    parked.set(current, new Map(storage));
    storage.clear();
    for (const [key, value] of parked.get(name) ?? []) {
        storage.set(key, value);
    }
    current = name;
}

/** What the server holds for the device's key. */
const serverRow = () =>
    d1.db
        .prepare('SELECT data FROM sync')
        .all()
        .map((row) => JSON.parse(row.data));

/** Waits (in turns of the event loop: the worker hashes the key off the main thread) until `done()` holds. */
async function until(done) {
    for (let turn = 0; turn < 200 && !done(); turn++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(done(), 'the request did not finish');
}

/** Lets the debounced push run (the two seconds, then the request) until `done()` holds. */
async function letPushRun(done) {
    mock.timers.tick(2000);
    await until(done);
}

beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    storage.clear();
    parked.clear();
    current = 'A';
    reloads = 0;
    connectToServer();
});

afterEach(() => {
    mock.timers.reset();
    globalThis.fetch = realFetch;
});

test('the build has a sync server, so the header shows the Sync button', () => {
    assert.equal(syncAvailable(), true);
});

test('the header button shows off, good, amber while catching up and red when the server lost the key', async () => {
    await startSync();
    assert.equal(syncLevel(), 'off');
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    assert.equal(syncLevel(), 'good');

    online = false;
    assert.equal((await pullSync()).code, 'network');
    assert.equal(syncLevel(), 'warn', 'the server is not reached');
    online = true;
    await pullSync();
    assert.equal(syncLevel(), 'good');

    writeJson(STORAGE_KEYS.settings, { budget: 41 });
    assert.equal(syncLevel(), 'warn', 'a change waits to be sent');
    await pushSync();
    assert.equal(syncLevel(), 'good');

    d1.db.exec('DELETE FROM sync');
    await pullSync();
    assert.equal(syncLevel(), 'bad');
    disableSync();
    assert.equal(syncLevel(), 'off');
});

test('every change of the state or of a call is announced to the header', async () => {
    announced = 0;
    await enableSync();
    const afterEnable = announced;
    assert.ok(afterEnable > 0);
    await pullSync();
    assert.ok(announced > afterEnable);
    const beforeOff = announced;
    disableSync();
    assert.ok(announced > beforeOff);
});

test('turning sync on makes a key and uploads what the device saved', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    writeJson(STORAGE_KEYS.locale, { not: 'synced' });
    assert.equal(syncStatus().on, false);
    assert.equal(await enableSync(), 'ok');

    const status = syncStatus();
    assert.equal(status.on, true);
    assert.match(status.key, /^[a-z2-7]{26}$/);
    assert.ok(status.synced > 0);
    const [data] = serverRow();
    assert.deepEqual(Object.keys(data), ['settings']);
    assert.deepEqual(data.settings.value, { budget: 40 });
    assert.deepEqual(readJson(STORAGE_KEYS.sync).dirty, []);
    assert.equal(readJson(STORAGE_KEYS.sync).revs.settings, data.settings.rev);
});

test('sync stays off when the server cannot be reached', async () => {
    online = false;
    assert.equal(await enableSync(), 'network');
    assert.equal(syncStatus().on, false);
    assert.equal(readText(STORAGE_KEYS.sync), null);
});

test('a second device joins with the pairing code of the first and takes its data', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    writeJson(STORAGE_KEYS.gearProgress, { g: { done: 2 } });
    await enableSync();
    const { code, pairing } = await createPairing();
    assert.equal(code, 'ok');
    assert.match(pairing.code, /^\d{6}$/);
    assert.deepEqual(await pairingPending(), { code: 'ok', pending: true });
    const keyOfA = syncStatus().key;

    useDevice('B');
    writeJson(STORAGE_KEYS.settings, { budget: 5 });
    writeJson(STORAGE_KEYS.lordSetup, { level: 3 });
    assert.equal(await connectWithCode(pairing.code), 'ok');
    assert.equal(syncStatus().key, keyOfA);
    assert.deepEqual(readJson(STORAGE_KEYS.settings), { budget: 40 });
    assert.deepEqual(readJson(STORAGE_KEYS.gearProgress), { g: { done: 2 } });
    assert.equal(readText(STORAGE_KEYS.lordSetup), null, "B's own entry the synced data lacks is dropped");
    assert.deepEqual(readJson(STORAGE_KEYS.sync).dirty, []);

    useDevice('A');
    assert.deepEqual(await pairingPending(), { code: 'ok', pending: false });
    useDevice('B');
    assert.equal(await connectWithCode(pairing.code), 'notFound', 'a code works once');
});

test('a device joins with the key itself too, and a wrong key finds nothing', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    const { key } = syncStatus();
    useDevice('B');
    assert.equal(await connectWithKey('q'.repeat(26)), 'notFound');
    assert.equal(syncStatus().on, false);
    assert.equal(await connectWithKey(key), 'ok');
    assert.deepEqual(readJson(STORAGE_KEYS.settings), { budget: 40 });
});

test('a change is pushed two seconds later and the other device takes it', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    const { pairing } = await createPairing();
    useDevice('B');
    await connectWithCode(pairing.code);
    await startSync();

    writeJson(STORAGE_KEYS.settings, { budget: 60 });
    assert.deepEqual(readJson(STORAGE_KEYS.sync).dirty, ['settings']);
    mock.timers.tick(1999);
    assert.equal(serverRow()[0].settings.value.budget, 40, 'not yet');
    await letPushRun(() => serverRow()[0].settings.value.budget === 60);
    await until(() => readJson(STORAGE_KEYS.sync).dirty.length === 0);

    useDevice('A');
    assert.deepEqual(await pullSync(), { code: 'ok', changed: true });
    assert.deepEqual(readJson(STORAGE_KEYS.settings), { budget: 60 });
    assert.deepEqual(readJson(STORAGE_KEYS.sync).dirty, [], "what was taken isn't pushed back");
    assert.deepEqual(await pullSync(), { code: 'ok', changed: false });
});

test('saving the same text again is no change', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    assert.deepEqual(readJson(STORAGE_KEYS.sync).dirty, []);
});

test('a change made offline wins over an older change elsewhere', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    const { pairing } = await createPairing();
    useDevice('B');
    await connectWithCode(pairing.code);
    await startSync();

    writeJson(STORAGE_KEYS.settings, { budget: 99 });
    await letPushRun(() => serverRow()[0].settings.value.budget === 99);
    await until(() => readJson(STORAGE_KEYS.sync).dirty.length === 0);
    useDevice('A');
    online = false;
    writeJson(STORAGE_KEYS.settings, { budget: 1 });
    await letPushRun(() => syncStatus().code === 'network');
    assert.deepEqual(readJson(STORAGE_KEYS.sync).dirty, ['settings'], 'kept for later');

    online = true;
    assert.deepEqual(await pullSync(), { code: 'ok', changed: false });
    assert.equal(serverRow()[0].settings.value.budget, 1);
    assert.deepEqual(readJson(STORAGE_KEYS.settings), { budget: 1 });
    assert.deepEqual(readJson(STORAGE_KEYS.sync).dirty, []);
});

test('what changes while a push is on its way is pushed next', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    writeJson(STORAGE_KEYS.settings, { budget: 41 });
    const pushing = pushSync();
    writeJson(STORAGE_KEYS.settings, { budget: 42 });
    assert.equal(await pushing, 'ok');
    assert.deepEqual(readJson(STORAGE_KEYS.sync).dirty, ['settings']);
    assert.equal(await pushSync(), 'ok');
    assert.equal(serverRow()[0].settings.value.budget, 42);
});

test('a key the server lost is reported, not brought back by the next change', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    d1.db.exec('DELETE FROM sync');

    assert.deepEqual(await pullSync(), { code: 'notFound', changed: false });
    assert.equal(syncStatus().code, 'notFound');
    writeJson(STORAGE_KEYS.settings, { budget: 50 });
    assert.equal(await pushSync(), 'notFound');
    assert.equal(serverRow().length, 0);
    assert.deepEqual(readJson(STORAGE_KEYS.settings), { budget: 50 }, 'the device keeps its data');

    assert.equal(await uploadAgain(), 'ok');
    assert.equal(serverRow()[0].settings.value.budget, 50);
});

test('turning sync off keeps the data and stops following it', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    disableSync();
    assert.equal(syncStatus().on, false);
    writeJson(STORAGE_KEYS.settings, { budget: 41 });
    assert.equal(readText(STORAGE_KEYS.sync), null);
    assert.equal(serverRow()[0].settings.value.budget, 40, 'the server keeps what it has');
    assert.deepEqual(await pullSync(), { code: 'off', changed: false });
    assert.equal(await pushSync(), 'off');
});

test('deleting removes the data from the server and turns sync off', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    assert.equal(await deleteSync(), 'ok');
    assert.equal(syncStatus().on, false);
    assert.equal(serverRow().length, 0);
    assert.deepEqual(readJson(STORAGE_KEYS.settings), { budget: 40 });
});

test('deleting fails when the server is not reached, and sync stays on', async () => {
    await enableSync();
    online = false;
    assert.equal(await deleteSync(), 'network');
    assert.equal(syncStatus().on, true);
});

test('a new key moves the data over and removes the old row', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    const oldKey = syncStatus().key;
    assert.equal(await rotateKey(), 'ok');
    assert.notEqual(syncStatus().key, oldKey);
    const rows = serverRow();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].settings.value.budget, 40);
});

test('a new key that cannot be uploaded leaves the old one', async () => {
    await enableSync();
    const oldKey = syncStatus().key;
    online = false;
    assert.equal(await rotateKey(), 'network');
    assert.equal(syncStatus().key, oldKey);
});

test('a page start pulls, and the tab being hidden or shown syncs', async () => {
    writeJson(STORAGE_KEYS.settings, { budget: 40 });
    await enableSync();
    const { pairing } = await createPairing();
    useDevice('B');
    await connectWithCode(pairing.code);

    await startSync();
    assert.ok(handlers['document:visibilitychange'] && handlers['window:pagehide']);

    // Hidden with a change waiting: it is sent at once (no two seconds).
    writeJson(STORAGE_KEYS.settings, { budget: 70 });
    globalThis.document.visibilityState = 'hidden';
    handlers['document:visibilitychange']();
    await until(() => serverRow()[0].settings.value.budget === 70);

    // Shown again after another device changed something: the page reloads to show it.
    useDevice('A');
    await pullSync();
    writeJson(STORAGE_KEYS.settings, { budget: 80 });
    await pushSync();
    useDevice('B');
    globalThis.document.visibilityState = 'visible';
    await handlers['document:visibilitychange']();
    assert.equal(reloads, 1);
    assert.deepEqual(readJson(STORAGE_KEYS.settings), { budget: 80 });

    // Nothing new: no reload.
    await handlers['document:visibilitychange']();
    assert.equal(reloads, 1);

    // Leaving the page flushes too.
    writeJson(STORAGE_KEYS.settings, { budget: 90 });
    handlers['window:pagehide']();
    await until(() => serverRow()[0].settings.value.budget === 90);
});

test('a page start without sync, or without the server, just goes on', async () => {
    await startSync();
    assert.equal(syncStatus().on, false);
    await enableSync();
    online = false;
    await startSync();
    assert.equal(syncStatus().code, 'network');
});

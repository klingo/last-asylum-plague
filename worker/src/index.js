/**
 * The sync server of Klingo's Companion: a Cloudflare Worker with a D1 database (schema.sql), the only backend of an
 * otherwise static site. It keeps each sync key's entries (settings and progress, see core/sync.js) and hands a key to
 * a second device through a short pairing code.
 *
 * The key is the login: 128 random bits, sent in `Authorization: Bearer <key>` (never in the URL) and stored only as its
 * SHA-256. Anyone with the key can read and change its entries, so nothing personal is kept. Routes:
 *   GET    /sync         the key's `{ entries: { name: { value, rev } } }`; 404 when there is none
 *   PUT    /sync         `{ entries: { name: value }, create? }` merged in, each with a new `rev` (this server's time);
 *                        without `create`, a key that has no row is a 404 (it was deleted, don't bring it back)
 *   DELETE /sync         removes the key's row
 *   POST   /pair         a six-digit code for this key, valid 10 minutes and for one use; `{ code, expiresIn }`
 *   GET    /pair         `{ pending }`: whether this key's code is still unclaimed
 *   POST   /pair/claim   `{ code }` gives `{ key }` and uses the code up (no login: the code is it)
 *
 * Abuse guards, as a browser's CORS rules don't bind scripts: the key and body shapes are checked, requests are
 * limited per IP (Workers rate-limiting binding `LIMITER`, and counters in D1 for the strict limits: claims and new
 * keys), and rows nobody used for 180 days are deleted by the daily cron (`scheduled`).
 */
import { MAX_BODY_BYTES, isPairingCode, isSyncKey, validEntries } from '../../webapp/src/core/sync.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PAIRING_TTL = 10 * MINUTE;
const RETENTION = 180 * DAY;
// A row's `last_seen` is only rewritten when it is older than this (a read doesn't need a write every time).
const TOUCH_AFTER = DAY;
// The strict limits per IP: at most `max` events per `window`.
const LIMITS = {
    claim: { max: 5, window: 10 * MINUTE },
    create: { max: 10, window: 60 * MINUTE },
};
// How often a free code is looked for before giving up (six digits: a clash is rare).
const CODE_TRIES = 5;
// A page opened from this machine (`wrangler dev` with `vite`) may always call; the deployed site is in `ALLOWED_ORIGINS`.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** A JSON response (never cached). */
function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    });
}

const fail = (status, error, headers) => json({ error }, status, headers);

/** The SHA-256 of `text` as hex. */
async function sha256(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A six-digit code. */
function randomCode() {
    const [number] = crypto.getRandomValues(new Uint32Array(1));
    return String(number % 1_000_000).padStart(6, '0');
}

/** Whether a page of `origin` may call this server. */
function originAllowed(origin, env) {
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((entry) => entry.trim());
    return LOCAL_ORIGIN.test(origin) || allowed.includes(origin);
}

/**
 * Counts one event of `kind` for `ip` and tells whether it is still within the limit. Counted before the work, so
 * failed attempts count too.
 */
async function withinLimit(db, kind, ip, now) {
    const { max, window } = LIMITS[kind];
    const bucket = `${kind}:${ip}`;
    await db
        .prepare(
            `INSERT INTO limits (bucket, count, window_start) VALUES (?1, 1, ?2)
             ON CONFLICT (bucket) DO UPDATE SET
                 count = CASE WHEN window_start <= ?2 - ?3 THEN 1 ELSE count + 1 END,
                 window_start = CASE WHEN window_start <= ?2 - ?3 THEN ?2 ELSE window_start END`,
        )
        .bind(bucket, now, window)
        .run();
    const row = await db.prepare('SELECT count FROM limits WHERE bucket = ?1').bind(bucket).first();
    return row.count <= max;
}

/** The request's JSON body, or null when it is too large or isn't JSON. */
async function readBody(request) {
    if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) {
        return null;
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** The key of the request's `Authorization: Bearer` header, or null. */
function bearerKey(request) {
    const key = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
    return isSyncKey(key) ? key : null;
}

/** Marks the row as used today (a write only when its mark is older than a day). */
function touch(db, id, now) {
    return db
        .prepare('UPDATE sync SET last_seen = ?1 WHERE id = ?2 AND last_seen < ?3')
        .bind(now, id, now - TOUCH_AFTER)
        .run();
}

async function getEntries(db, id, now) {
    const row = await db.prepare('SELECT data FROM sync WHERE id = ?1').bind(id).first();
    if (!row) {
        return null;
    }
    await touch(db, id, now);
    return JSON.parse(row.data);
}

async function putEntries(db, id, request, ip, now, headers) {
    const body = await readBody(request);
    const entries = validEntries(body?.entries);
    if (!entries) {
        return fail(400, 'entries', headers);
    }
    const stored = await db.prepare('SELECT data FROM sync WHERE id = ?1').bind(id).first();
    if (!stored) {
        if (body.create !== true) {
            return fail(404, 'unknown', headers);
        }
        if (!(await withinLimit(db, 'create', ip, now))) {
            return fail(429, 'limit', headers);
        }
    }
    const data = stored ? JSON.parse(stored.data) : {};
    for (const [name, value] of Object.entries(entries)) {
        // Always above the entry's last rev, even when two changes come in the same millisecond.
        data[name] = { value, rev: Math.max(now, (data[name]?.rev ?? 0) + 1) };
    }
    await db
        .prepare(
            `INSERT INTO sync (id, data, updated_at, last_seen) VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT (id) DO UPDATE SET data = ?2, updated_at = ?3, last_seen = ?3`,
        )
        .bind(id, JSON.stringify(data), now)
        .run();
    return json({ entries: data }, 200, headers);
}

/** A new pairing code for the key (its earlier one stops working). */
async function createPairing(db, id, key, now, headers) {
    if (!(await db.prepare('SELECT 1 AS found FROM sync WHERE id = ?1').bind(id).first())) {
        return fail(404, 'unknown', headers);
    }
    await db.prepare('DELETE FROM pairing WHERE sync_id = ?1 OR expires_at <= ?2').bind(id, now).run();
    for (let attempt = 0; attempt < CODE_TRIES; attempt++) {
        const code = randomCode();
        const { meta } = await db
            .prepare('INSERT OR IGNORE INTO pairing (code, sync_id, sync_key, expires_at) VALUES (?1, ?2, ?3, ?4)')
            .bind(code, id, key, now + PAIRING_TTL)
            .run();
        if (meta.changes === 1) {
            return json({ code, expiresIn: PAIRING_TTL / 1000 }, 200, headers);
        }
    }
    return fail(503, 'busy', headers);
}

/** Hands the key of a live code over and uses the code up. */
async function claimPairing(db, request, ip, now, headers) {
    if (!(await withinLimit(db, 'claim', ip, now))) {
        return fail(429, 'limit', headers);
    }
    const body = await readBody(request);
    if (!isPairingCode(body?.code)) {
        return fail(400, 'code', headers);
    }
    const row = await db
        .prepare('SELECT sync_key FROM pairing WHERE code = ?1 AND expires_at > ?2')
        .bind(body.code, now)
        .first();
    if (!row) {
        return fail(404, 'code', headers);
    }
    await db.prepare('DELETE FROM pairing WHERE code = ?1').bind(body.code).run();
    return json({ key: row.sync_key }, 200, headers);
}

/** Answers `request`; `env.DB` is the D1 database, `now` the time in milliseconds. */
async function handle(request, env, now = Date.now()) {
    const origin = request.headers.get('Origin');
    if (origin !== null && !originAllowed(origin, env)) {
        return fail(403, 'origin');
    }
    const headers = origin === null ? {} : { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...headers,
                'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Max-Age': '86400',
            },
        });
    }
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.LIMITER && !(await env.LIMITER.limit({ key: ip })).success) {
        return fail(429, 'limit', headers);
    }

    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname}`;
    const db = env.DB;
    if (route === 'POST /pair/claim') {
        return claimPairing(db, request, ip, now, headers);
    }
    if (!['GET /sync', 'PUT /sync', 'DELETE /sync', 'POST /pair', 'GET /pair'].includes(route)) {
        return fail(404, 'route', headers);
    }
    const key = bearerKey(request);
    if (!key) {
        return fail(401, 'key', headers);
    }
    const id = await sha256(key);
    switch (route) {
        case 'GET /sync': {
            const entries = await getEntries(db, id, now);
            return entries ? json({ entries }, 200, headers) : fail(404, 'unknown', headers);
        }
        case 'PUT /sync':
            return putEntries(db, id, request, ip, now, headers);
        case 'DELETE /sync':
            await db.batch([
                db.prepare('DELETE FROM sync WHERE id = ?1').bind(id),
                db.prepare('DELETE FROM pairing WHERE sync_id = ?1').bind(id),
            ]);
            return json({}, 200, headers);
        case 'POST /pair':
            return createPairing(db, id, key, now, headers);
        default: {
            const row = await db
                .prepare('SELECT 1 AS found FROM pairing WHERE sync_id = ?1 AND expires_at > ?2')
                .bind(id, now)
                .first();
            return json({ pending: row !== null }, 200, headers);
        }
    }
}

/** The daily clean-up: keys unused for 180 days, expired codes and old limit counters. */
function cleanUp(db, now = Date.now()) {
    return db.batch([
        db.prepare('DELETE FROM sync WHERE last_seen < ?1').bind(now - RETENTION),
        db.prepare('DELETE FROM pairing WHERE expires_at <= ?1').bind(now),
        db.prepare('DELETE FROM limits WHERE window_start < ?1').bind(now - DAY),
    ]);
}

export default {
    async fetch(request, env) {
        try {
            return await handle(request, env);
        } catch (error) {
            console.error(error);
            return fail(500, 'server');
        }
    },
    scheduled(_event, env, context) {
        context.waitUntil(cleanUp(env.DB));
    },
};

export { handle, cleanUp };

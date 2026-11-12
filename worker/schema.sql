-- The sync data of Klingo's Companion (src/index.js). Apply it from this folder with:
--   npx wrangler d1 execute last-asylum-plague-sync --remote --file schema.sql

-- One row per sync key. `id` is the SHA-256 of the key, so the table doesn't reveal any key.
-- `data` is the JSON `{ <entry name>: { value, rev } }`; times are milliseconds since the epoch.
CREATE TABLE IF NOT EXISTS sync (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
);

-- A pairing code and the key it hands over, for 10 minutes and one use: the only place a key is kept in clear.
CREATE TABLE IF NOT EXISTS pairing (
    code       TEXT PRIMARY KEY,
    sync_id    TEXT NOT NULL,
    sync_key   TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pairing_sync_id ON pairing (sync_id);

-- Counters of the strict limits (per IP and kind): `count` events since `window_start`.
CREATE TABLE IF NOT EXISTS limits (
    bucket       TEXT PRIMARY KEY,
    count        INTEGER NOT NULL,
    window_start INTEGER NOT NULL
);

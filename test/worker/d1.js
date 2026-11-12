/**
 * A stand-in for the sync worker's D1 database: Node's built-in SQLite (in memory) with the schema of
 * worker/schema.sql, behind the few methods of D1 the worker uses (`prepare().bind().run() / first()`, `batch`).
 * `db` is the SQLite database itself, for tests that look at the rows.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8');

function createD1() {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA);
    const statement = (sql, values = []) => ({
        bind: (...bound) => statement(sql, bound),
        run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
        first: async () => db.prepare(sql).get(...values) ?? null,
    });
    return {
        db,
        prepare: (sql) => statement(sql),
        batch: async (statements) => Promise.all(statements.map((one) => one.run())),
    };
}

export { createD1 };

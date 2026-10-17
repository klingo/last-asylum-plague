/**
 * Shared test helpers: the frozen pack data fixture (so the goldens don't move when data/pack_data.json is
 * edited) and golden files (`UPDATE_GOLDEN=1 npm test` rewrites them; a normal run compares).
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expandPackageFamilies } from '../webapp/src/lib/catalog.js';

const FIXTURE_PATH = path.join(import.meta.dirname, 'fixtures', 'pack_data.json');
const GOLDEN_DIR = path.join(import.meta.dirname, 'golden');
// Relative tolerance for numbers (float noise across platforms, not real changes).
const TOLERANCE = 1e-6;

/** The fixture as the webapp sees it: package tier ladders expanded (ui data.js does the same). */
function loadFixture() {
    const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    return { ...raw, packages: expandPackageFamilies(raw.packages || {}) };
}

/** 9 significant digits: stable in the file, and well inside TOLERANCE. */
function round(value) {
    return Number.isFinite(value) ? Number(value.toPrecision(9)) : value;
}

/** Maps / Sets to sorted plain objects / arrays and numbers rounded, so the golden JSON is stable. */
function plain(value) {
    if (value instanceof Map) {
        return plain(Object.fromEntries([...value].sort(([a], [b]) => String(a).localeCompare(String(b)))));
    }
    if (value instanceof Set) {
        return [...value].sort();
    }
    if (Array.isArray(value)) {
        return value.map(plain);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)]));
    }
    if (typeof value === 'number') {
        // JSON has no Infinity / NaN.
        return Number.isFinite(value) ? round(value) : String(value);
    }
    return value;
}

function compare(actual, expected, where) {
    if (typeof expected === 'number' && typeof actual === 'number') {
        const scale = Math.max(Math.abs(expected), Math.abs(actual), 1e-12);
        assert.ok(Math.abs(actual - expected) / scale <= TOLERANCE, `${where}: ${actual} != ${expected}`);
        return;
    }
    if (expected && typeof expected === 'object') {
        assert.ok(actual && typeof actual === 'object', `${where}: expected an object/array`);
        assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${where}: keys differ`);
        for (const key of Object.keys(expected)) {
            compare(actual[key], expected[key], `${where}.${key}`);
        }
        return;
    }
    assert.equal(actual, expected, where);
}

/** Compares `value` with test/golden/<name>.json (or writes it with UPDATE_GOLDEN=1). */
function expectGolden(name, value) {
    const file = path.join(GOLDEN_DIR, `${name}.json`);
    const actual = plain(value);
    if (process.env.UPDATE_GOLDEN) {
        fs.mkdirSync(GOLDEN_DIR, { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(actual, null, 4)}\n`);
        return;
    }
    assert.ok(fs.existsSync(file), `${name}: no golden file yet (run UPDATE_GOLDEN=1 npm test)`);
    compare(actual, JSON.parse(fs.readFileSync(file, 'utf8')), name);
}

export { loadFixture, expectGolden };

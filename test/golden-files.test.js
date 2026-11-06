/**
 * Every file in test/golden/ is written and checked by some test: a golden whose test is gone would go stale
 * unnoticed (a test names its golden as a quoted string: `expectGolden('fit', ...)`, a scenario key).
 */
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TEST_DIR = import.meta.dirname;

/** The paths of every *.test.js below `dir`. */
function testFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return testFiles(file);
        }
        return entry.name.endsWith('.test.js') && file !== import.meta.filename ? [file] : [];
    });
}

test('each golden file belongs to a test', () => {
    const sources = testFiles(TEST_DIR).map((file) => fs.readFileSync(file, 'utf8'));
    const goldens = fs
        .readdirSync(path.join(TEST_DIR, 'golden'))
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.basename(file, '.json'));
    assert.ok(goldens.length > 0);
    const orphans = goldens.filter((name) => !sources.some((source) => source.includes(`'${name}'`)));
    assert.deepEqual(orphans, [], 'golden files no test names (delete them, or the test is missing)');
});

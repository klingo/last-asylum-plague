import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatJson, isMain, splitArgs } from '../../scripts/lib/data-files.js';

test('JSON is written with 4 spaces and a final newline', () => {
    assert.equal(formatJson({ a: [1] }), '{\n    "a": [\n        1\n    ]\n}\n');
});

test('the command line splits into --flags and the rest, in order', () => {
    const { flags, positional } = splitArgs(['strange_bazaar', '--show', '2026-10-12', '--help', '7']);
    assert.deepEqual([...flags], ['--show', '--help']);
    assert.deepEqual(positional, ['strange_bazaar', '2026-10-12', '7']);
});

test('a script imported by a test is not "run directly"', () => {
    assert.equal(isMain({ filename: '/somewhere/else.js' }), false);
});

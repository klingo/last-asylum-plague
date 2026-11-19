import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeTieFlags,
    formatAmount,
    formatCompact,
    formatPercent,
    formatSignificant,
    formatThousands,
} from '../../webapp/src/ui/format.js';

test('thousands are grouped with apostrophes, decimals with a point', () => {
    assert.equal(formatThousands(1234567), "1'234'567");
    assert.equal(formatThousands(-1234), "-1'234");
    assert.equal(formatThousands(999), '999');
    assert.equal(formatThousands(1234567.891, 2), "1'234'567.89");
});

test('given decimals pad and round, none keeps what the number has', () => {
    assert.equal(formatThousands(5.5, 4), '5.5000');
    assert.equal(formatThousands(5.5), '5.5');
    assert.equal(formatThousands(2.6, 0), '3');
    assert.equal(formatThousands(Number.NaN), 'NaN');
});

test('significant digits: whole from 100, two decimals from 1, three digits below', () => {
    assert.equal(formatSignificant(12345.6), "12'346");
    assert.equal(formatSignificant(5.5), '5.50');
    assert.equal(formatSignificant(0.0123456), '0.0123');
    assert.equal(formatSignificant(0.0000123456, 2), '0.000012');
    assert.equal(formatSignificant(0), '0');
    assert.equal(formatSignificant(Number.NaN), null);
});

test('an amount that may be fractional: whole numbers grouped, others significant', () => {
    assert.equal(formatAmount(12000), "12'000");
    assert.equal(formatAmount(0.25), '0.250');
});

test('a share becomes a percent with a non-breaking space', () => {
    assert.equal(formatPercent(0.1234), '12.3&nbsp;%');
    assert.equal(formatPercent(0.5, 0), '50&nbsp;%');
});

test('tied ranks are flagged, missing keys never tie', () => {
    assert.deepEqual(computeTieFlags(['1.0', '1.0', '0.5', null, null, '0.5']), [
        false,
        true,
        false,
        false,
        false,
        false,
    ]);
});

test('a big amount is written short as in the game: millions with a decimal, hundreds of thousands as K', () => {
    assert.equal(formatCompact(3200000), '3.2M');
    assert.equal(formatCompact(4000000), '4.0M');
    assert.equal(formatCompact(12500000), '12.5M');
    assert.equal(formatCompact(500000), '500K');
    assert.equal(formatCompact(123456), '123K');
    assert.equal(formatCompact(99999), "99'999", 'below 100000 as it is');
    assert.equal(formatCompact(15), '15');
    assert.equal(formatCompact(17.5), '17.5');
    assert.equal(formatCompact(0), '0');
});

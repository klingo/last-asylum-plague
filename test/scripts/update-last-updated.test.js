import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, stampLastUpdated } from '../../scripts/update-last-updated.js';

test('the date is written year-month-day in local time with two digits', () => {
    assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(localDate(new Date(2026, 10, 12, 0, 1)), '2026-11-12');
});

test('the stamp is set when it differs and left alone when it is today', () => {
    const data = {};
    assert.equal(stampLastUpdated(data, '2026-11-12'), true);
    assert.equal(data.metadata.last_updated, '2026-11-12');
    assert.equal(stampLastUpdated(data, '2026-11-12'), false);
    assert.equal(stampLastUpdated(data, '2026-11-13'), true);
    assert.equal(data.metadata.last_updated, '2026-11-13');
});

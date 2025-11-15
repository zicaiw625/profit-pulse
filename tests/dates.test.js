import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  startOfMonth,
  startOfNextMonth,
  getMonthKey,
} from '../app/utils/dates.server.js';

describe('dates utilities', () => {
  it('computes month boundaries respecting timezones', () => {
    const reference = new Date('2024-03-01T07:30:00.000Z');
    const start = startOfMonth(reference, { timezone: 'America/Los_Angeles' });
    const next = startOfNextMonth(reference, { timezone: 'America/Los_Angeles' });
    const { year, month } = getMonthKey(reference, { timezone: 'America/Los_Angeles' });

    assert.equal(start.toISOString(), '2024-02-01T08:00:00.000Z');
    assert.equal(next.toISOString(), '2024-03-01T08:00:00.000Z');
    assert.equal(year, 2024);
    assert.equal(month, 2);
  });

  it('falls back to UTC when timezone is not provided', () => {
    const reference = new Date('2024-11-15T12:00:00.000Z');
    const start = startOfMonth(reference);
    const next = startOfNextMonth(reference);
    const { year, month } = getMonthKey(reference);

    assert.equal(start.toISOString(), '2024-11-01T00:00:00.000Z');
    assert.equal(next.toISOString(), '2024-12-01T00:00:00.000Z');
    assert.equal(year, 2024);
    assert.equal(month, 11);
  });
});

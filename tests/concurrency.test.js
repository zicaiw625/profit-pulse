import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapWithConcurrency } from '../app/utils/concurrency.server.js';

describe('mapWithConcurrency', () => {
  it('limits the number of concurrent workers while preserving order', async () => {
    const items = Array.from({ length: 6 }, (_, index) => index + 1);
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency(items, 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 10;
    });

    assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
    assert.ok(peak <= 2);
  });

  it('handles empty input arrays', async () => {
    const results = await mapWithConcurrency([], 3, async () => 42);
    assert.deepEqual(results, []);
  });

  it('throws when worker is not a function', async () => {
    await assert.rejects(() => mapWithConcurrency([1, 2], 2, null), {
      name: 'TypeError',
    });
  });
});

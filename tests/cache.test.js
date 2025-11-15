import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  memoizeAsync,
  clearCache,
  setCacheBackendForTests,
  memoryCacheBackendFactory,
} from '../app/services/cache.server.js';

function createTestBackend() {
  return memoryCacheBackendFactory();
}

describe('memoizeAsync', () => {
  beforeEach(() => {
    setCacheBackendForTests(createTestBackend());
  });

  it('deduplicates concurrent computations', async () => {
    const compute = mock.fn(async () => 42);
    const [first, second] = await Promise.all([
      memoizeAsync('dedupe-key', 1000, compute),
      memoizeAsync('dedupe-key', 1000, compute),
    ]);

    assert.equal(first, 42);
    assert.equal(second, 42);
    assert.equal(compute.mock.callCount(), 1);
  });

  it('expires entries after ttl', async () => {
    const compute = mock.fn(async () => Date.now());
    const first = await memoizeAsync('ttl-key', 5, compute);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await memoizeAsync('ttl-key', 5, compute);

    assert.equal(compute.mock.callCount(), 2);
    assert.notEqual(first, second);
  });

  it('clearCache removes stored values', async () => {
    const compute = mock.fn(async () => Math.random());
    const first = await memoizeAsync('clear-key', 1000, compute);
    await clearCache('clear-key');
    const second = await memoizeAsync('clear-key', 1000, compute);

    assert.equal(compute.mock.callCount(), 2);
    assert.notEqual(first, second);
  });
});

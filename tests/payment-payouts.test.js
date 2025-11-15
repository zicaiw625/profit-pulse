import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  syncPaypalPayments,
  syncStripePayments,
  syncKlarnaPayments,
  setPaymentSyncDependenciesForTests,
  resetPaymentSyncDependenciesForTests,
  setExternalPayoutConcurrencyForTests,
  resetExternalPayoutConcurrencyForTests,
} from '../app/services/sync/payment-payouts.server.js';

const payouts = Array.from({ length: 5 }, (_, index) => ({
  payoutId: `p-${index + 1}`,
  grossAmount: 10 * (index + 1),
  feeTotal: 1,
}));

describe('external payout sync concurrency', () => {
  let startJobMock;
  let finishJobMock;
  let failJobMock;
  let persistMock;

  beforeEach(() => {
    startJobMock = mock.fn(async () => ({ id: 'job-1' }));
    finishJobMock = mock.fn(async () => {});
    failJobMock = mock.fn(async () => {});

    setExternalPayoutConcurrencyForTests(2);
    setPaymentSyncDependenciesForTests({
      startSyncJob: startJobMock,
      finishSyncJob: finishJobMock,
      failSyncJob: failJobMock,
    });
  });

  afterEach(() => {
    resetExternalPayoutConcurrencyForTests();
    resetPaymentSyncDependenciesForTests();
  });

  async function runWithConcurrencyTracking(fn) {
    let active = 0;
    let peak = 0;

    persistMock = mock.fn(async (...args) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return args;
    });

    setPaymentSyncDependenciesForTests({ persistExternalPayout: persistMock });

    await fn();

    return { peak };
  }

  it('limits PayPal upserts to the configured concurrency', async () => {
    const fetchMock = mock.fn(async () => payouts);
    setPaymentSyncDependenciesForTests({ fetchPaypalPayouts: fetchMock });

    const { peak } = await runWithConcurrencyTracking(() =>
      syncPaypalPayments({ store: { id: 'store-1' }, days: 3 }),
    );

    assert.ok(peak <= 2);
    assert.equal(startJobMock.mock.callCount(), 1);
    assert.equal(finishJobMock.mock.callCount(), 1);
    assert.equal(failJobMock.mock.callCount(), 0);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(persistMock.mock.callCount(), payouts.length);
  });

  it('limits Stripe upserts to the configured concurrency', async () => {
    const fetchMock = mock.fn(async () => payouts);
    setPaymentSyncDependenciesForTests({ fetchStripePayouts: fetchMock });

    const { peak } = await runWithConcurrencyTracking(() =>
      syncStripePayments({ store: { id: 'store-2' }, days: 5 }),
    );

    assert.ok(peak <= 2);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(persistMock.mock.callCount(), payouts.length);
  });

  it('limits Klarna upserts to the configured concurrency', async () => {
    const fetchMock = mock.fn(async () => payouts);
    setPaymentSyncDependenciesForTests({ fetchKlarnaPayouts: fetchMock });

    const { peak } = await runWithConcurrencyTracking(() =>
      syncKlarnaPayments({ store: { id: 'store-3' }, days: 2 }),
    );

    assert.ok(peak <= 2);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(persistMock.mock.callCount(), payouts.length);
  });
});

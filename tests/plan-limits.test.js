import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PlanTier } from '@prisma/client';

import {
  ensureOrderCapacity,
  setPlanLimitsPrismaForTests,
  setPlanOverageSchedulerForTests,
} from '../app/services/plan-limits.server.js';
import { PlanLimitError } from '../app/errors/plan-limit-error.js';

const noopCount = async () => 0;
const noopFindUsage = async () => null;

const basePrismaMock = {
  subscription: {
    findUnique: async () => null,
  },
  store: { count: noopCount },
  adAccountCredential: { count: noopCount },
  monthlyOrderUsage: {
    findUnique: noopFindUsage,
  },
  order: {
    count: noopCount,
  },
};

describe('ensureOrderCapacity', () => {
  afterEach(() => {
    setPlanLimitsPrismaForTests();
    setPlanOverageSchedulerForTests();
  });

  it('schedules an overage record when non-transactional usage exceeds the limit', async () => {
    const scheduleMock = mock.fn(async (payload) => ({
      id: 'overage-mock',
      ...payload,
    }));
    setPlanOverageSchedulerForTests(scheduleMock);

    const prismaMock = {
      ...basePrismaMock,
      subscription: {
        findUnique: async () => ({
          plan: PlanTier.BASIC,
          orderLimit: 100,
        }),
      },
      monthlyOrderUsage: {
        findUnique: async () => ({ orders: 98 }),
      },
    };
    setPlanLimitsPrismaForTests(prismaMock);

    const result = await ensureOrderCapacity({
      merchantId: 'merchant-non-tx',
      incomingOrders: 5,
      shopDomain: 'brand.myshopify.com',
    });

    assert.equal(result.overageRecord, null);
    assert.equal(scheduleMock.mock.callCount(), 1);
    const [args] = scheduleMock.mock.calls[0].arguments;
    assert.equal(args.merchantId, 'merchant-non-tx');
    assert.equal(args.metric, 'orders');
    assert.equal(args.unitsRequired, 1);
    assert.equal(args.shopDomain, 'brand.myshopify.com');
  });

  it('throws a PlanLimitError when the allowance is exhausted and no overage is configured', async () => {
    const scheduleMock = mock.fn(async () => {
      throw new Error('should not be called when no overage is configured');
    });
    setPlanOverageSchedulerForTests(scheduleMock);

    const prismaMock = {
      ...basePrismaMock,
      subscription: {
        findUnique: async () => ({
          plan: PlanTier.FREE,
          orderLimit: 100,
        }),
      },
      monthlyOrderUsage: {
        findUnique: async () => ({ orders: 100 }),
      },
    };
    setPlanLimitsPrismaForTests(prismaMock);

    await assert.rejects(
      () =>
        ensureOrderCapacity({
          merchantId: 'merchant-hard-cap',
          incomingOrders: 1,
        }),
      (error) => {
        assert.ok(error instanceof PlanLimitError);
        assert.equal(error.code, 'ORDER_LIMIT_REACHED');
        return true;
      },
    );

    assert.equal(scheduleMock.mock.callCount(), 0);
  });

  it('increments usage and returns the overage record when running inside a transaction', async () => {
    const scheduleMock = mock.fn(async (payload) => ({
      id: 'overage-tx',
      ...payload,
    }));
    setPlanOverageSchedulerForTests(scheduleMock);

    const updateMock = mock.fn(async () => ({}));

    const tx = {
      subscription: {
        findUnique: async () => ({
          plan: PlanTier.BASIC,
          orderLimit: 100,
        }),
      },
      $executeRaw: mock.fn(async () => {}),
      $queryRaw: mock.fn(async () => [{ orders: 90 }]),
      monthlyOrderUsage: {
        update: updateMock,
      },
    };

    const result = await ensureOrderCapacity({
      merchantId: 'merchant-tx',
      incomingOrders: 15,
      tx,
      shopDomain: 'brand-tx.myshopify.com',
    });

    assert.equal(scheduleMock.mock.callCount(), 1);
    const [payload] = scheduleMock.mock.calls[0].arguments;
    assert.equal(payload.tx, tx);
    assert.equal(payload.unitsRequired, 1);
    assert.equal(result.overageRecord.id, 'overage-tx');
    assert.equal(updateMock.mock.callCount(), 1);
    const [updateArgs] = updateMock.mock.calls[0].arguments;
    assert.equal(updateArgs.data.orders.increment, 15);
  });
});

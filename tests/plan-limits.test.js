import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PlanTier } from '@prisma/client';

import {
  getPlanUsage,
  ensureOrderCapacity,
  setPlanLimitsPrismaForTests,
  setPlanOverageSchedulerForTests,
} from '../app/services/plan-limits.server.js';
import { PlanLimitError } from '../app/errors/plan-limit-error.js';
import prisma from '../app/db.server.js';
import { schedulePlanOverageRecord } from '../app/services/overages.server.js';

const noopCount = async () => 0;
const noopFindUsage = async () => null;

const basePrismaMock = {
  subscription: {
    findUnique: async () => null,
  },
  merchantAccount: {
    findUnique: async () => ({ primaryTimezone: 'UTC' }),
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
    mock.restoreAll();
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
      merchantAccount: {
        findUnique: async () => ({ primaryTimezone: 'UTC' }),
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

  it('does not schedule an overage when usage stays below the limit', async () => {
    const scheduleMock = mock.fn(async () => {
      throw new Error('should not schedule when below the limit');
    });
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
        findUnique: async () => ({ orders: 95 }),
      },
    };
    setPlanLimitsPrismaForTests(prismaMock);

    const result = await ensureOrderCapacity({
      merchantId: 'merchant-near-limit',
      incomingOrders: 4,
    });

    assert.equal(result.overageRecord, null);
    assert.equal(scheduleMock.mock.callCount(), 0);
  });

  it('allows landing exactly on the limit without scheduling overage usage', async () => {
    const scheduleMock = mock.fn(async () => {
      throw new Error('should not schedule when hitting the limit exactly');
    });
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
        findUnique: async () => ({ orders: 99 }),
      },
    };
    setPlanLimitsPrismaForTests(prismaMock);

    const result = await ensureOrderCapacity({
      merchantId: 'merchant-limit',
      incomingOrders: 1,
    });

    assert.equal(result.overageRecord, null);
    assert.equal(scheduleMock.mock.callCount(), 0);
  });

  it('uses the merchant timezone when determining the monthly window', async () => {
    const now = new Date('2024-03-01T07:30:00.000Z');
    const monthlyUsageMock = mock.fn(async () => null);
    const orderCountMock = mock.fn(async () => 12);

    const prismaMock = {
      ...basePrismaMock,
      subscription: {
        findUnique: async () => ({
          plan: PlanTier.BASIC,
          orderLimit: 1000,
        }),
      },
      merchantAccount: {
        findUnique: async () => ({ primaryTimezone: 'America/Los_Angeles' }),
      },
      monthlyOrderUsage: {
        findUnique: monthlyUsageMock,
      },
      order: {
        count: orderCountMock,
      },
    };

    setPlanLimitsPrismaForTests(prismaMock);

    await getPlanUsage({ merchantId: 'merchant-tz', referenceDate: now });

    assert.equal(monthlyUsageMock.mock.callCount(), 1);
    const [{ where: monthlyWhere }] = monthlyUsageMock.mock.calls[0].arguments;
    assert.equal(monthlyWhere.merchantId_year_month.month, 2);
    assert.equal(monthlyWhere.merchantId_year_month.year, 2024);

    assert.equal(orderCountMock.mock.callCount(), 1);
    const [countArgs] = orderCountMock.mock.calls[0].arguments;
    assert.equal(countArgs.where.processedAt.gte.toISOString(), '2024-02-01T08:00:00.000Z');
    assert.equal(countArgs.where.processedAt.lt.toISOString(), '2024-03-01T08:00:00.000Z');
  });
});

describe('schedulePlanOverageRecord', () => {
  it('creates additional units only when required and avoids duplicate charges', async (t) => {
    let billedUnits = 2;
    const aggregateCalls = [];
    const createCalls = [];
    const originalAggregate = prisma.planOverageRecord.aggregate;
    const originalCreate = prisma.planOverageRecord.create;

    prisma.planOverageRecord.aggregate = async (args) => {
      aggregateCalls.push(args);
      return { _sum: { units: billedUnits } };
    };
    prisma.planOverageRecord.create = async ({ data }) => {
      createCalls.push(data);
      billedUnits += data.units;
      return { id: 'overage-created', ...data };
    };

    t.after(() => {
      prisma.planOverageRecord.aggregate = originalAggregate;
      prisma.planOverageRecord.create = originalCreate;
    });

    const basePayload = {
      merchantId: 'merchant-overage',
      metric: 'orders',
      unitsRequired: 5,
      unitAmount: 15,
      currency: 'USD',
      description: 'Additional orders',
      year: 2025,
      month: 3,
      shopDomain: 'brand.myshopify.com',
    };

    const first = await schedulePlanOverageRecord(basePayload);
    assert.equal(createCalls.length, 1);
    assert.equal(aggregateCalls.length, 1);
    assert.equal(first.units, 3);

    const second = await schedulePlanOverageRecord(basePayload);
    assert.equal(second, null);
    assert.equal(createCalls.length, 1);
    assert.equal(aggregateCalls.length, 2);
  });
});

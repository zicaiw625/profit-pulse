import { describe, it, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { PlanTier } from "@prisma/client";
import {
  ensureOrderCapacity,
  getPlanUsage,
  setPlanLimitsPrismaForTests,
} from "../app/services/plan-limits.server.js";
import { PlanLimitError } from "../app/errors/plan-limit-error.js";

const BASE_PRISMA_STUB = {
  subscription: {
    findUnique: async () => ({
      plan: PlanTier.BASIC,
      orderLimit: 1000,
      storeLimit: 1,
      status: "ACTIVE",
    }),
  },
  merchantAccount: {
    findUnique: async () => ({ primaryTimezone: "UTC" }),
  },
  store: {
    count: async () => 1,
  },
  monthlyOrderUsage: {
    findUnique: async () => ({ orders: 250 }),
  },
  order: {
    count: async () => 250,
  },
};

describe("plan-limits.server", () => {
  afterEach(() => {
    setPlanLimitsPrismaForTests();
    mock.restoreAll();
  });

  it("returns store and order usage for getPlanUsage", async () => {
    setPlanLimitsPrismaForTests(BASE_PRISMA_STUB);
    const result = await getPlanUsage({ merchantId: "m-1" });
    assert.equal(result.usage.stores.count, 1);
    assert.equal(result.usage.orders.count, 250);
    assert.equal(result.usage.orders.limit, 1000);
    assert.equal(result.usage.stores.status, "ok");
  });

  it("throws when usage exceeds limit without a transaction", async () => {
    const prismaMock = {
      ...BASE_PRISMA_STUB,
      monthlyOrderUsage: {
        findUnique: async () => ({ orders: 1000 }),
      },
    };
    setPlanLimitsPrismaForTests(prismaMock);

    await assert.rejects(
      () =>
        ensureOrderCapacity({
          merchantId: "m-limit",
          incomingOrders: 5,
          shopDomain: "demo.myshopify.com",
        }),
      (error) => {
        assert.ok(error instanceof PlanLimitError);
        assert.equal(error.code, "ORDER_LIMIT_REACHED");
        return true;
      },
    );
  });

  it("increments usage inside a transaction when capacity is available", async () => {
    const tx = {
      subscription: {
        findUnique: async () => ({
          plan: PlanTier.PRO,
          orderLimit: 5000,
          status: "ACTIVE",
        }),
      },
      merchantAccount: {
        findUnique: async () => ({ primaryTimezone: "UTC" }),
      },
      $executeRaw: mock.fn(async () => {}),
      $queryRaw: mock.fn(async () => [{ orders: 100 }]),
      monthlyOrderUsage: {
        update: mock.fn(async () => ({})),
      },
    };

    await ensureOrderCapacity({
      merchantId: "m-tx",
      incomingOrders: 50,
      tx,
      shopDomain: "brand-tx.myshopify.com",
    });

    assert.equal(tx.$executeRaw.mock.callCount(), 1);
    assert.equal(tx.$queryRaw.mock.callCount(), 1);
    assert.equal(tx.monthlyOrderUsage.update.mock.callCount(), 1);
  });

  it("rejects inactive subscriptions when the trial has ended", async () => {
    const prismaMock = {
      ...BASE_PRISMA_STUB,
      subscription: {
        findUnique: async () => ({
          plan: PlanTier.BASIC,
          orderLimit: 1000,
          storeLimit: 1,
          status: "PAST_DUE",
          trialEndsAt: new Date(0),
        }),
      },
      monthlyOrderUsage: {
        findUnique: async () => ({ orders: 0 }),
      },
    };
    setPlanLimitsPrismaForTests(prismaMock);

    await assert.rejects(
      () => ensureOrderCapacity({ merchantId: "m-inactive" }),
      (error) => {
        assert.ok(error instanceof PlanLimitError);
        assert.equal(error.code, "SUBSCRIPTION_INACTIVE");
        return true;
      },
    );
  });

  it("allows temporarily relaxing subscription checks via env override", async () => {
    const original = process.env.ALLOW_INACTIVE_SUBSCRIPTIONS;
    process.env.ALLOW_INACTIVE_SUBSCRIPTIONS = "true";

    const prismaMock = {
      ...BASE_PRISMA_STUB,
      subscription: {
        findUnique: async () => ({
          plan: PlanTier.BASIC,
          orderLimit: 1000,
          storeLimit: 1,
          status: "CANCELLED",
          trialEndsAt: null,
        }),
      },
      monthlyOrderUsage: {
        findUnique: async () => ({ orders: 0 }),
      },
    };
    setPlanLimitsPrismaForTests(prismaMock);

    try {
      await ensureOrderCapacity({ merchantId: "m-inactive-overridden" });
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_INACTIVE_SUBSCRIPTIONS;
      } else {
        process.env.ALLOW_INACTIVE_SUBSCRIPTIONS = original;
      }
    }
  });
});

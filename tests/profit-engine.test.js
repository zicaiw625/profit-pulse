import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDemoOrder,
  processShopifyOrder,
  resetProfitEngineDependenciesForTests,
  setProfitEngineDependenciesForTests,
} from "../app/services/profit-engine.server.js";
import { PlanLimitError } from "../app/errors/plan-limit-error.js";

function createTransactionStub() {
  return {
    order: {
      findUnique: async () => null,
      upsert: async () => ({ id: "order-db-id" }),
    },
    orderCost: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
    refundRecord: {
      deleteMany: async () => undefined,
      findMany: async () => [],
      createMany: async () => undefined,
      updateMany: async () => undefined,
    },
    dailyMetric: {
      findUnique: async (args) => {
        const channel =
          args?.where?.storeId_channel_productSku_date?.channel ??
          args?.where?.channel;
        if (channel === "TOTAL") {
          return { adSpend: 0, revenue: 0 };
        }
        return null;
      },
      create: async () => undefined,
      update: async () => undefined,
      upsert: async () => undefined,
      findMany: async () => [],
    },
    orderAttribution: {
      deleteMany: async () => undefined,
      createMany: async () => undefined,
    },
  };
}

function createPrismaStub(storeRecord, tx) {
  return {
    store: {
      findUnique: async () => storeRecord,
    },
    $transaction: async (callback) => callback(tx),
  };
}

test("processShopifyOrder charges overages after a successful sync", async (t) => {
  const storeRecord = {
    id: "store-1",
    merchantId: "merchant-1",
    merchant: { id: "merchant-1" },
    shopDomain: "demo.myshopify.com",
  };
  const tx = createTransactionStub();
  const prismaStub = createPrismaStub(storeRecord, tx);
  const ensureCalls = [];
  const chargeCalls = [];
  const notifyCalls = [];

  setProfitEngineDependenciesForTests({
    prismaClient: prismaStub,
    getActiveSkuCostMap: async () =>
      new Map([
        ["HD-0001", 40],
        ["TR-441", 70],
      ]),
    getVariableCostTemplates: async () => [],
    getLogisticsCost: async () => 0,
    ensureOrderCapacity: async (args) => {
      ensureCalls.push(args);
      return { overageRecord: { id: "overage-1" } };
    },
    processPlanOverageCharge: async (id) => {
      chargeCalls.push(id);
    },
    notifyPlanOverage: async (info) => {
      notifyCalls.push(info);
    },
    getAttributionRules: async () => [],
  });

  t.after(() => {
    resetProfitEngineDependenciesForTests();
  });

  const result = await processShopifyOrder({
    store: { id: storeRecord.id },
    payload: buildDemoOrder(),
  });

  assert.ok(result.revenue > 0, "should calculate revenue");
  assert.equal(ensureCalls.length, 1);
  assert.equal(ensureCalls[0].tx, tx);
  assert.deepEqual(chargeCalls, ["overage-1"]);
  assert.equal(notifyCalls.length, 0, "should not notify plan overage on success");
});

test("processShopifyOrder notifies when plan limits are exceeded", async (t) => {
  const storeRecord = {
    id: "store-2",
    merchantId: "merchant-2",
    merchant: { id: "merchant-2" },
    shopDomain: "demo.myshopify.com",
  };
  const tx = createTransactionStub();
  const prismaStub = createPrismaStub(storeRecord, tx);
  const notifyCalls = [];

  setProfitEngineDependenciesForTests({
    prismaClient: prismaStub,
    getActiveSkuCostMap: async () =>
      new Map([
        ["HD-0001", 40],
        ["TR-441", 70],
      ]),
    getVariableCostTemplates: async () => [],
    getLogisticsCost: async () => 0,
    ensureOrderCapacity: async () => {
      throw new PlanLimitError({
        code: "ORDER_LIMIT_REACHED",
        message: "limit reached",
        detail: { limit: 100, usage: 120 },
      });
    },
    processPlanOverageCharge: async () => {
      throw new Error("should not charge when limits block the sync");
    },
    notifyPlanOverage: async (info) => {
      notifyCalls.push(info);
    },
    getAttributionRules: async () => [],
  });

  t.after(() => {
    resetProfitEngineDependenciesForTests();
  });

  await assert.rejects(
    () =>
      processShopifyOrder({
        store: { id: storeRecord.id },
        payload: buildDemoOrder(),
      }),
    (error) => error instanceof PlanLimitError,
  );

  assert.equal(notifyCalls.length, 1);
  assert.deepEqual(notifyCalls[0], {
    merchantId: storeRecord.merchantId,
    limit: 100,
    usage: 120,
  });
});

test("processShopifyOrder records missing SKU cost metrics", async (t) => {
  const storeRecord = {
    id: "store-3",
    merchantId: "merchant-3",
    merchant: { id: "merchant-3" },
    shopDomain: "demo.myshopify.com",
  };
  const tx = createTransactionStub();
  const prismaStub = createPrismaStub(storeRecord, tx);
  const recordCalls = [];

  setProfitEngineDependenciesForTests({
    prismaClient: prismaStub,
    getActiveSkuCostMap: async () =>
      new Map([
        ["HD-0001", 0],
        ["TR-441", 50],
      ]),
    getVariableCostTemplates: async () => [],
    ensureOrderCapacity: async () => undefined,
    getAttributionRules: async () => [],
    recordOrderProcessing: (args) => {
      recordCalls.push(args);
    },
  });

  t.after(() => {
    resetProfitEngineDependenciesForTests();
  });

  await processShopifyOrder({
    store: { id: storeRecord.id },
    payload: buildDemoOrder(),
  });

  assert.equal(recordCalls.length, 1);
  assert.equal(recordCalls[0].totals?.missingSkuCostCount, 1);
});

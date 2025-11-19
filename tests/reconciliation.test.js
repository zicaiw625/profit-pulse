import test from "node:test";
import assert from "node:assert/strict";

import {
  detectPaymentDiscrepancies,
  detectAdConversionAnomalies,
  setReconciliationDependenciesForTests,
  resetReconciliationDependenciesForTests,
} from "../app/services/reconciliation.server.js";

function buildPrismaStub({
  payouts = [],
  orderGroups = [],
  adSpendGroups = [],
}) {
  const createManyCalls = [];
  const prismaStub = {
    paymentPayout: {
      findMany: async () => payouts,
    },
    order: {
      groupBy: async () => orderGroups,
    },
    adSpendRecord: {
      groupBy: async () => adSpendGroups,
    },
    reconciliationIssue: {
      updateMany: async () => undefined,
      createMany: async ({ data }) => {
        createManyCalls.push(data);
      },
    },
    store: {
      findUnique: async () => ({
        id: "store-1",
        timezone: "UTC",
        merchant: { timezone: "UTC" },
      }),
    },
  };
  return { prismaStub, createManyCalls };
}

test("detectPaymentDiscrepancies ignores tiny deltas", async (t) => {
  const payoutDate = new Date();
  const { prismaStub } = buildPrismaStub({
    payouts: [
      {
        payoutDate,
        netAmount: 98,
        currency: "USD",
        payoutId: "pay-1",
      },
    ],
    orderGroups: [
      {
        processedAt: payoutDate,
        _sum: { total: 100 },
      },
    ],
  });

  setReconciliationDependenciesForTests({ prismaClient: prismaStub });
  t.after(() => resetReconciliationDependenciesForTests());

  const issues = await detectPaymentDiscrepancies({ storeId: "store-1" });
  assert.equal(issues.length, 0);
});

test("detectPaymentDiscrepancies records large variances", async (t) => {
  const payoutDate = new Date();
  const { prismaStub } = buildPrismaStub({
    payouts: [
      {
        payoutDate,
        netAmount: 50,
        currency: "USD",
        payoutId: "pay-2",
      },
    ],
    orderGroups: [
      {
        processedAt: payoutDate,
        _sum: { total: 150 },
      },
    ],
  });

  setReconciliationDependenciesForTests({ prismaClient: prismaStub });
  t.after(() => resetReconciliationDependenciesForTests());

  const issues = await detectPaymentDiscrepancies({ storeId: "store-2" });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueType, "SHOPIFY_VS_PAYMENT");
});

test("detectAdConversionAnomalies flags high spend with zero conversions", async (t) => {
  const adDate = new Date();
  const { prismaStub } = buildPrismaStub({
    payouts: [],
    orderGroups: [
      {
        processedAt: adDate,
        _count: { _all: 10 },
      },
    ],
    adSpendGroups: [
      {
        provider: "META_ADS",
        date: adDate,
        _sum: {
          conversions: 0,
          spend: 250,
        },
      },
    ],
  });

  setReconciliationDependenciesForTests({ prismaClient: prismaStub });
  t.after(() => resetReconciliationDependenciesForTests());

  const issues = await detectAdConversionAnomalies({ storeId: "store-3" });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueType, "SHOPIFY_VS_ADS");
});


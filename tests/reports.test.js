import test from "node:test";
import assert from "node:assert/strict";

import {
  getCustomReportData,
  getReportingOverview,
  setReportServiceDependenciesForTests,
  resetReportServiceDependenciesForTests,
} from "../app/services/reports.server.js";

function buildStoreContext() {
  return {
    id: "store1",
    currency: "USD",
    merchantId: "merchant1",
    merchant: { primaryCurrency: "USD" },
  };
}

test("getCustomReportData appends custom formulas", async () => {
  const fakePrisma = {
    store: {
      findUnique: async () => buildStoreContext(),
    },
    dailyMetric: {
      async groupBy() {
        return [
          {
            channel: "META_ADS",
            _sum: {
              revenue: 100,
              netProfit: 40,
              adSpend: 20,
              cogs: 0,
              shippingCost: 0,
              paymentFees: 0,
              refundAmount: 0,
              orders: 2,
            },
          },
        ];
      },
    },
    order: { findMany: async () => [] },
    orderCost: { findMany: async () => [] },
    refundRecord: { findMany: async () => [] },
    orderAttribution: { findMany: async () => [] },
  };

  setReportServiceDependenciesForTests({
    prismaClient: fakePrisma,
    getExchangeRate: async () => 1,
  });

  try {
    const result = await getCustomReportData({
      storeId: "store1",
      metrics: ["revenue", "netProfit", "adSpend"],
      formula: "netProfit / adSpend",
      formulaLabel: "NPAS",
    });

    assert.equal(result.metrics.at(-1)?.label, "NPAS");
    const customMetric = result.rows[0].metrics.find(
      (metric) => metric.label === "NPAS",
    );
    assert.ok(customMetric);
    assert.equal(customMetric.value, 2);
  } finally {
    resetReportServiceDependenciesForTests();
  }
});

test("getReportingOverview memoizes and applies fixed cost allocations", async () => {
  const memoizeCalls = [];
  const fakePrisma = {
    store: {
      findUnique: async () => buildStoreContext(),
    },
    dailyMetric: {
      async groupBy({ by }) {
        if (by.includes("channel")) {
          return [
            {
              channel: "META_ADS",
              _sum: {
                revenue: 100,
                adSpend: 50,
                netProfit: 30,
                orders: 10,
              },
            },
          ];
        }
        if (by.includes("productSku")) {
          return [
            {
              productSku: "SKU-1",
              _sum: {
                revenue: 50,
                netProfit: 20,
                orders: 5,
                units: 5,
                adSpend: 10,
                refundAmount: 0,
                refunds: 0,
              },
            },
          ];
        }
        throw new Error("Unexpected groupBy request");
      },
      async aggregate() {
        return {
          _sum: {
            revenue: 100,
            netProfit: 30,
            adSpend: 50,
            orders: 10,
            refundAmount: 0,
            refunds: 0,
            cogs: 20,
            shippingCost: 5,
            paymentFees: 2,
          },
        };
      },
      async findMany() {
        return [];
      },
    },
  };

  setReportServiceDependenciesForTests({
    prismaClient: fakePrisma,
    getExchangeRate: async () => 1,
    getFixedCostBreakdown: async () => ({
      total: 10,
      allocations: { perChannel: { META_ADS: 5 }, unassigned: 1 },
      items: [],
    }),
    buildCacheKey: (...parts) => parts.join("|"),
    memoizeAsync: async (key, ttl, compute) => {
      memoizeCalls.push({ key, ttl });
      return compute();
    },
  });

  try {
    const overview = await getReportingOverview({
      storeId: "store1",
      rangeDays: 7,
    });

    assert.equal(memoizeCalls.length, 1);
    assert.ok(memoizeCalls[0].key.includes("reporting-overview"));
    assert.equal(overview.summary.fixedCosts, 10);
    assert.equal(overview.summary.netProfitAfterFixed, 20);
    assert.equal(overview.channels[0].netProfitAfterFixed, 25);
  } finally {
    resetReportServiceDependenciesForTests();
  }
});

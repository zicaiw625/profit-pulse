import assert from "node:assert/strict";
import test from "node:test";

import {
  resetOrderSyncConcurrencyForTests,
  resetShopifyOrderSyncDependenciesForTests,
  setOrderSyncConcurrencyForTests,
  setShopifyOrderSyncDependenciesForTests,
  syncShopifyOrders,
} from "../app/services/sync/shopify-orders.server.js";

function createShopifyStub(responses) {
  class RestClientStub {
    constructor() {
      this.calls = 0;
    }

    async get() {
      const response = responses[this.calls] ?? { body: { orders: [] }, pageInfo: {} };
      this.calls += 1;
      return response;
    }
  }

  return {
    api: {
      clients: {
        Rest: RestClientStub,
      },
    },
  };
}

function createPrismaStub(latestOrder) {
  return {
    order: {
      findFirst: async () => latestOrder,
    },
  };
}

test("syncShopifyOrders paginates and respects the configured concurrency", async (t) => {
  const latestOrder = {
    processedAt: new Date("2024-06-02T10:00:00.000Z"),
  };
  const responses = [
    {
      body: {
        orders: [
          { id: "gid://shopify/Order/1" },
          { id: "gid://shopify/Order/2" },
        ],
      },
      pageInfo: {
        nextPage: { query: { page_info: "cursor-1" } },
      },
    },
    {
      body: {
        orders: [
          { id: "gid://shopify/Order/3" },
          { id: "gid://shopify/Order/4" },
          { id: "gid://shopify/Order/5" },
        ],
      },
      pageInfo: {},
    },
  ];

  const processedIds = [];
  let active = 0;
  let maxActive = 0;

  setShopifyOrderSyncDependenciesForTests({
    prismaClient: createPrismaStub(latestOrder),
    shopifyApi: createShopifyStub(responses),
    processShopifyOrder: async ({ payload }) => {
      processedIds.push(payload.id);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
    },
  });
  setOrderSyncConcurrencyForTests(2);

  t.after(() => {
    resetShopifyOrderSyncDependenciesForTests();
    resetOrderSyncConcurrencyForTests();
  });

  const result = await syncShopifyOrders({
    store: { id: "store-1" },
    session: { shop: "demo-shop.myshopify.com", accessToken: "token" },
    days: 7,
  });

  assert.equal(result.processed, 5);
  assert.deepEqual(processedIds, [
    "gid://shopify/Order/1",
    "gid://shopify/Order/2",
    "gid://shopify/Order/3",
    "gid://shopify/Order/4",
    "gid://shopify/Order/5",
  ]);
  assert.ok(maxActive <= 2, "should not exceed configured concurrency");

  const expectedStart = new Date(latestOrder.processedAt);
  expectedStart.setUTCDate(expectedStart.getUTCDate() - 1);
  assert.equal(result.processedAtMin.toISOString(), expectedStart.toISOString());
});

test("syncShopifyOrders defaults to extended lookback for new stores", async (t) => {
  const responses = [
    {
      body: { orders: [] },
      pageInfo: {},
    },
  ];

  let processCalls = 0;

  setShopifyOrderSyncDependenciesForTests({
    prismaClient: createPrismaStub(null),
    shopifyApi: createShopifyStub(responses),
    processShopifyOrder: async () => {
      processCalls += 1;
    },
  });
  setOrderSyncConcurrencyForTests(3);

  t.after(() => {
    resetShopifyOrderSyncDependenciesForTests();
    resetOrderSyncConcurrencyForTests();
  });

  const before = Date.now();
  const result = await syncShopifyOrders({
    store: { id: "store-new" },
    session: { shop: "demo-shop.myshopify.com", accessToken: "token" },
    days: 20,
  });
  const after = Date.now();

  assert.equal(result.processed, 0);
  assert.equal(processCalls, 0);

  const diffMs = after - result.processedAtMin.getTime();
  const dayMs = 1000 * 60 * 60 * 24;
  const diffDays = diffMs / dayMs;
  assert.ok(
    diffDays >= 19.9 && diffDays <= 20.1,
    `expected lookback to be about 20 days but was ${diffDays.toFixed(2)}`,
  );

  const earliestAllowed = before - dayMs * 20.1;
  const latestAllowed = after - dayMs * 19.9;
  const processedAtMs = result.processedAtMin.getTime();
  assert.ok(
    processedAtMs >= earliestAllowed && processedAtMs <= latestAllowed,
    "processedAtMin should reflect the extended lookback",
  );
});

test("syncShopifyOrders can force a requested lookback window even when orders exist", async (t) => {
  const latestOrder = {
    processedAt: new Date("2024-06-10T10:00:00.000Z"),
  };
  const responses = [
    {
      body: { orders: [] },
      pageInfo: {},
    },
  ];

  setShopifyOrderSyncDependenciesForTests({
    prismaClient: createPrismaStub(latestOrder),
    shopifyApi: createShopifyStub(responses),
    processShopifyOrder: async () => {},
  });

  t.after(() => {
    resetShopifyOrderSyncDependenciesForTests();
    resetOrderSyncConcurrencyForTests();
  });

  const before = Date.now();
  const result = await syncShopifyOrders({
    store: { id: "store-2" },
    session: { shop: "demo-shop.myshopify.com", accessToken: "token" },
    days: 30,
    useRequestedLookback: true,
  });
  const after = Date.now();

  const dayMs = 1000 * 60 * 60 * 24;
  const diffDays = (after - result.processedAtMin.getTime()) / dayMs;
  assert.ok(
    diffDays >= 29.9 && diffDays <= 30.1,
    `expected lookback to honor the requested 30 days but was ${diffDays.toFixed(2)}`,
  );
});

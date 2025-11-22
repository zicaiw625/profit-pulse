import assert from "node:assert/strict";
import test from "node:test";
import { CostType } from "@prisma/client";

import {
  buildDemoOrder,
  processShopifyOrder,
  resetProfitEngineDependenciesForTests,
  setProfitEngineDependenciesForTests,
} from "../app/services/profit-engine.server.js";

function createRecorder() {
  const orderUpserts = [];
  const orderCostBatches = [];
  const refundDeletes = [];
  const refundUpserts = [];
  const orderAttributionDeletes = [];
  const orderAttributionCreates = [];
  const metricMap = new Map();
  let metricIdCounter = 1;

  function keyFromParts({ storeId, channel, productSku, date }) {
    const normalizedDate =
      date instanceof Date ? date.toISOString() : new Date(date).toISOString();
    return `${storeId}|${channel ?? "null"}|${productSku ?? "null"}|${normalizedDate}`;
  }

  function keyFromWhere(where) {
    if (where.storeId_channel_productSku_date) {
      return keyFromParts(where.storeId_channel_productSku_date);
    }
    return keyFromParts(where);
  }

  function matchesWhere(record, where = {}) {
    if (!where) return true;
    if (where.storeId && record.storeId !== where.storeId) return false;
    if (where.date) {
      const expectedDate =
        where.date instanceof Date ? where.date : new Date(where.date);
      if (record.date.getTime() !== expectedDate.getTime()) return false;
    }
    if (Object.prototype.hasOwnProperty.call(where, "productSku")) {
      if (where.productSku !== record.productSku) return false;
    }
    if (where.channel) {
      if (where.channel.in) {
        return where.channel.in.includes(record.channel);
      }
      if (record.channel !== where.channel) {
        return false;
      }
    }
    return true;
  }

  const tx = {
    order: {
      findUnique: async () => null,
      upsert: async (args) => {
        orderUpserts.push(args);
        return { id: "order-db-id" };
      },
    },
    orderCost: {
      deleteMany: async () => {
        return undefined;
      },
      createMany: async ({ data }) => {
        orderCostBatches.push(data);
        return undefined;
      },
    },
    refundRecord: {
      deleteMany: async (args) => {
        refundDeletes.push(args);
        return undefined;
      },
      upsert: async (args) => {
        refundUpserts.push(args);
        return { id: `refund-${refundUpserts.length}`, ...args.create };
      },
    },
    dailyMetric: {
      findUnique: async ({ where }) => {
        const key = keyFromWhere(where);
        return metricMap.get(key) ?? null;
      },
      create: async ({ data }) => {
        const record = { id: `metric-${metricIdCounter++}`, ...data };
        const key = keyFromParts({
          storeId: record.storeId,
          channel: record.channel,
          productSku: record.productSku ?? null,
          date: record.date,
        });
        metricMap.set(key, record);
        return record;
      },
      update: async ({ where, data }) => {
        const key = keyFromWhere(where);
        const existing = metricMap.get(key);
        if (!existing) {
          throw new Error("Attempted to update missing metric record");
        }
        const updated = { ...existing };
        for (const [field, change] of Object.entries(data)) {
          if (change && typeof change.increment === "number") {
            updated[field] = (updated[field] ?? 0) + change.increment;
          } else if (typeof change === "number") {
            updated[field] = change;
          }
        }
        metricMap.set(key, updated);
        return updated;
      },
      findMany: async ({ where }) => {
        return Array.from(metricMap.values()).filter((record) =>
          matchesWhere(record, where),
        );
      },
      upsert: async ({ where, create, update }) => {
        const existing = await tx.dailyMetric.findUnique({ where });
        if (existing) {
          return tx.dailyMetric.update({ where, data: update });
        }
        return tx.dailyMetric.create({ data: create });
      },
    },
    orderAttribution: {
      deleteMany: async (args) => {
        orderAttributionDeletes.push(args);
        return undefined;
      },
      createMany: async ({ data }) => {
        orderAttributionCreates.push(data);
        return undefined;
      },
    },
  };

  return {
    tx,
    orderUpserts,
    orderCostBatches,
    refundDeletes,
    refundUpserts,
    orderAttributionCreates,
    orderAttributionDeletes,
    metricMap,
  };
}

function assertClose(actual, expected, epsilon = 1e-6, message) {
  const delta = Math.abs(actual - expected);
  assert.ok(
    delta <= epsilon,
    `${message ?? "value"} expected ${expected} ±${epsilon}, received ${actual}`,
  );
}

test(
  "processShopifyOrder persists orders, costs, refunds, and metrics for demo payload",
  async (t) => {
    const storeRecord = {
      id: "store-demo",
      merchantId: "merchant-demo",
      merchant: { id: "merchant-demo" },
      shopDomain: "demo.myshopify.com",
      currency: "USD",
      timezone: "UTC",
    };

    const recorder = createRecorder();
    const ensureCalls = [];
    const overageCharges = [];
    const overageNotifications = [];

    const prismaStub = {
      store: { findUnique: async () => storeRecord },
      $transaction: async (callback) => callback(recorder.tx),
    };

    setProfitEngineDependenciesForTests({
      prismaClient: prismaStub,
      getActiveSkuCostMap: async () =>
        new Map([
          ["HD-0001", 40],
          ["TR-441", 70],
        ]),
      getVariableCostTemplates: async () => [
        {
          id: "payment-fee",
          name: "Payment Processor",
          type: CostType.PAYMENT_FEE,
          lines: [
            { percentageRate: 0.02, flatAmount: 1 },
          ],
          config: { gateway: "shopify_payments" },
        },
        {
          id: "shipping-template",
          name: "Shipping Insurance",
          type: CostType.SHIPPING,
          lines: [{ flatAmount: 3.5 }],
        },
      ],
      getLogisticsCost: async () => 7.5,
      ensureOrderCapacity: async (payload) => {
        ensureCalls.push(payload);
        return { overageRecord: null };
      },
      notifyPlanOverage: async (...args) => {
        overageNotifications.push(args);
      },
      processPlanOverageCharge: async (...args) => {
        overageCharges.push(args);
      },
      getAttributionRules: async () => [],
    });

    t.after(() => {
      resetProfitEngineDependenciesForTests();
    });

    const orderPayload = buildDemoOrder();
    orderPayload.refunds = [
      {
        id: 1001,
        processed_at: orderPayload.processed_at,
        note: "Partial refund",
        restock: false,
        transactions: [
          { id: 1, amount: "-20.00", currency: "USD" },
        ],
        refund_line_items: [
          {
            line_item: { sku: "TR-441" },
            subtotal_set: { shop_money: { amount: "20.00", currency_code: "USD" } },
          },
        ],
      },
    ];

    const result = await processShopifyOrder({
      store: { id: storeRecord.id },
      payload: orderPayload,
    });

    assert.equal(ensureCalls.length, 1);
    assert.equal(ensureCalls[0].merchantId, storeRecord.merchantId);
    assert.equal(ensureCalls[0].tx, recorder.tx);
    assert.deepEqual(overageCharges, []);
    assert.deepEqual(overageNotifications, []);

    assert.equal(recorder.orderUpserts.length, 1);
    const upsertArgs = recorder.orderUpserts[0];
    assert.equal(upsertArgs.create.storeId, storeRecord.id);
    assert.equal(upsertArgs.create.shopifyOrderId, String(orderPayload.id));
    assert.deepEqual(upsertArgs.create.lineItems.create, [
      {
        productId: "1",
        variantId: "11",
        sku: "HD-0001",
        title: "Aurora Hoodie",
        quantity: 2,
        price: 120,
        discount: 10,
        revenue: 230,
        cogs: 80,
      },
      {
        productId: "2",
        variantId: "21",
        sku: "TR-441",
        title: "Trail Shoes",
        quantity: 1,
        price: 195,
        discount: 5,
        revenue: 190,
        cogs: 70,
      },
    ]);

    assert.equal(recorder.orderCostBatches.length, 1);
    const costRows = recorder.orderCostBatches[0];
    assert.equal(costRows.length, 4);
    const cogsRow = costRows.find((row) => row.type === CostType.COGS);
    assert.ok(cogsRow, "should create COGS cost row");
    assert.equal(cogsRow.amount, 150);
    assert.equal(cogsRow.source, "SKU cost");
    const shippingTemplateRow = costRows.find(
      (row) => row.type === CostType.SHIPPING && row.source === "Template",
    );
    assert.ok(shippingTemplateRow, "should include template shipping cost");
    assertClose(
      shippingTemplateRow.amount,
      3.5,
      1e-6,
      "shipping template amount",
    );
    const logisticsRow = costRows.find(
      (row) => row.type === CostType.SHIPPING && row.source === "Logistics rule",
    );
    assert.ok(logisticsRow, "should include logistics shipping cost");
    assertClose(logisticsRow.amount, 7.5, 1e-6, "logistics amount");
    const paymentRow = costRows.find((row) => row.type === CostType.PAYMENT_FEE);
    assert.ok(paymentRow, "should include payment fee row");
    assertClose(paymentRow.amount, 10.37, 1e-6, "payment fee amount");
    assert.equal(paymentRow.source, "Payment gateway");

    assert.equal(recorder.refundDeletes.length, 1);
    assert.equal(recorder.refundUpserts.length, 1);
    const refundArgs = recorder.refundUpserts[0];
    assert.equal(refundArgs.create.orderShopifyId, String(orderPayload.id));
    assert.equal(refundArgs.create.amount, 20);
    assert.equal(refundArgs.create.restock, false);

    const metricValues = Array.from(recorder.metricMap.values());
    const totalMetric = metricValues.find((row) => row.channel === "TOTAL");
    assert.ok(totalMetric, "should create TOTAL metric row");
    assert.equal(totalMetric.orders, 1);
    assert.equal(totalMetric.units, 3);
    assertClose(totalMetric.revenue, 483.5, 1e-6, "total revenue");
    assertClose(totalMetric.cogs, 150, 1e-6, "total cogs");
    assertClose(totalMetric.shippingCost, 11, 1e-6, "shipping cost aggregate");
    assertClose(totalMetric.paymentFees, 10.37, 1e-6, "payment fee aggregate");
    assertClose(totalMetric.refundAmount, 20, 1e-6, "refund amount");
    assert.equal(totalMetric.refunds, 1);
    assertClose(totalMetric.grossProfit, 312.13, 1e-6, "gross profit");
    assertClose(totalMetric.netProfit, 312.13, 1e-6, "net profit");

    const expectedDate = new Date(orderPayload.processed_at);
    expectedDate.setUTCHours(0, 0, 0, 0);
    assert.equal(totalMetric.date.getTime(), expectedDate.getTime());

    assertClose(result.revenue, 483.5, 1e-6, "result revenue");
    assertClose(result.cogsTotal, 150, 1e-6, "result cogs");
    assertClose(result.grossProfit, 312.13, 1e-6, "result gross");
    assertClose(result.netProfit, 312.13, 1e-6, "result net");
    assert.equal(result.variableCosts.length, 2);
    const paymentCost = result.variableCosts.find(
      (cost) => cost.type === CostType.PAYMENT_FEE,
    );
    assertClose(paymentCost.amount, 10.37, 1e-6, "variable payment fee");
    const shippingCost = result.variableCosts.find(
      (cost) => cost.type === CostType.SHIPPING,
    );
    assertClose(shippingCost.amount, 3.5, 1e-6, "variable shipping cost");
    assert.equal(result.refunds.length, 1);
    assertClose(result.refunds[0].amount, 20, 1e-6, "result refund amount");
  },
);

test(
  "processShopifyOrder allocates ad spend and tolerates missing SKU costs alongside refunds",
  async (t) => {
    const storeRecord = {
      id: "store-integrated",
      merchantId: "merchant-integrated",
      merchant: { id: "merchant-integrated" },
      shopDomain: "integrated.myshopify.com",
      currency: "USD",
      timezone: "UTC",
    };

    const recorder = createRecorder();
    const metricsEvents = [];

    const prismaStub = {
      store: { findUnique: async () => storeRecord },
      $transaction: async (callback) => callback(recorder.tx),
    };

    setProfitEngineDependenciesForTests({
      prismaClient: prismaStub,
      getActiveSkuCostMap: async () =>
        new Map([
          ["WITH-COST", 25],
        ]),
      getVariableCostTemplates: async () => [
        {
          id: "shipping",
          name: "Shipping",
          type: CostType.SHIPPING,
          lines: [{ flatAmount: 5 }],
        },
      ],
      ensureOrderCapacity: async () => undefined,
      getAttributionRules: async () => [
        {
          provider: "META_ADS",
          touches: [{ ruleType: "LAST_TOUCH", weight: 1 }],
        },
      ],
      recordOrderProcessing: (event) => {
        metricsEvents.push(event);
      },
    });

    t.after(() => {
      resetProfitEngineDependenciesForTests();
    });

    const processedAt = new Date("2024-02-24T13:00:00.000Z");
    const metricDate = new Date(processedAt);
    metricDate.setUTCHours(0, 0, 0, 0);

    await recorder.tx.dailyMetric.create({
      data: {
        storeId: storeRecord.id,
        channel: "TOTAL",
        productSku: null,
        date: metricDate,
        currency: "USD",
        orders: 0,
        units: 0,
        revenue: 1000,
        adSpend: 200,
        cogs: 0,
        shippingCost: 0,
        paymentFees: 0,
        refundAmount: 0,
        refunds: 0,
        grossProfit: 0,
        netProfit: 0,
      },
    });

    await recorder.tx.dailyMetric.create({
      data: {
        storeId: storeRecord.id,
        channel: "META_ADS",
        productSku: null,
        date: metricDate,
        currency: "USD",
        orders: 0,
        units: 0,
        revenue: 0,
        adSpend: 200,
        cogs: 0,
        shippingCost: 0,
        paymentFees: 0,
        refundAmount: 0,
        refunds: 0,
        grossProfit: 0,
        netProfit: 0,
      },
    });

    const payload = {
      id: "missing-cost-order",
      name: "#1001",
      currency: "USD",
      current_total_price: "215.00",
      current_total_tax: "5.00",
      current_total_discounts: "0.00",
      current_subtotal_price: "200.00",
      source_name: "online",
      processed_at: processedAt.toISOString(),
      gateway: "shopify_payments",
      line_items: [
        {
          product_id: 10,
          variant_id: 11,
          sku: "WITH-COST",
          title: "Known SKU",
          quantity: 1,
          price: "120.00",
          total_discount: "0.00",
        },
        {
          product_id: 20,
          variant_id: 21,
          sku: "NO-COST",
          title: "Missing SKU",
          quantity: 1,
          price: "80.00",
          total_discount: "0.00",
        },
      ],
      shipping_lines: [
        {
          title: "UPS Ground",
          price: "10.00",
        },
      ],
      refunds: [
        {
          id: "refund-1",
          processed_at: processedAt.toISOString(),
          transactions: [{ id: "t-1", amount: "-15.00", currency: "USD" }],
          refund_line_items: [
            {
              line_item: { sku: "NO-COST" },
              total_set: { shop_money: { amount: "15.00", currency_code: "USD" } },
            },
          ],
        },
      ],
    };

    const result = await processShopifyOrder({
      store: { id: storeRecord.id },
      payload,
    });

    assert.equal(metricsEvents.length, 1);
    assert.equal(metricsEvents[0].totals?.missingSkuCostCount, 1);

    assert.equal(recorder.orderUpserts.length, 1);
    const [costBatch] = recorder.orderCostBatches;
    const cogsRow = costBatch.find((row) => row.type === CostType.COGS);
    assert.ok(cogsRow, "expected COGS row");
    assert.equal(cogsRow.amount, 25, "only known SKU contributes to COGS");

    const totalMetric = Array.from(recorder.metricMap.values()).find(
      (metric) => metric.channel === "TOTAL",
    );
    assert.ok(totalMetric, "should update TOTAL metric");
    assert.equal(totalMetric.orders, 1);
    assertClose(totalMetric.refundAmount, 15, 1e-6, "refund total recorded");

    assert.equal(recorder.orderAttributionCreates.length, 1);
    const [attributionRows] = recorder.orderAttributionCreates;
    assert.equal(attributionRows.length, 1);
    assert.equal(attributionRows[0].provider, "META_ADS");
    assertClose(
      attributionRows[0].amount,
      43,
      1e-3,
      "ad attribution amount should reflect revenue share",
    );

    assert.equal(result.refunds.length, 1);
    assertClose(result.refunds[0].amount, 15, 1e-6, "refund amount returned");
  },
);

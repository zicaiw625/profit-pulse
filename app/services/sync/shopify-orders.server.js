import defaultPrisma from "../../db.server.js";
import { processShopifyOrder as defaultProcessShopifyOrder } from "../profit-engine.server.js";

const DEFAULT_CONCURRENCY = Number.parseInt(
  process.env.ORDER_SYNC_CONCURRENCY ?? "5",
  10,
);

const defaultDependencies = {
  prismaClient: defaultPrisma,
  shopifyApi: null,
  processShopifyOrder: defaultProcessShopifyOrder,
};

let orderSyncDependencies = { ...defaultDependencies };
let configuredConcurrency = Number.isFinite(DEFAULT_CONCURRENCY)
  ? DEFAULT_CONCURRENCY
  : 5;
let shopifyModulePromise;

export function setShopifyOrderSyncDependenciesForTests(overrides = {}) {
  orderSyncDependencies = { ...orderSyncDependencies, ...overrides };
}

export function resetShopifyOrderSyncDependenciesForTests() {
  orderSyncDependencies = { ...defaultDependencies };
  shopifyModulePromise = undefined;
}

export function setOrderSyncConcurrencyForTests(value) {
  configuredConcurrency = Number.isFinite(value) && value > 0 ? value : configuredConcurrency;
}

export function resetOrderSyncConcurrencyForTests() {
  configuredConcurrency = Number.isFinite(DEFAULT_CONCURRENCY)
    ? DEFAULT_CONCURRENCY
    : 5;
}

function getOrderSyncDependencies() {
  return orderSyncDependencies;
}

function resolveConcurrency() {
  return Number.isFinite(configuredConcurrency) && configuredConcurrency > 0
    ? configuredConcurrency
    : 5;
}

async function loadShopifyApi() {
  const { shopifyApi } = getOrderSyncDependencies();
  if (shopifyApi) {
    return shopifyApi;
  }
  if (!shopifyModulePromise) {
    shopifyModulePromise = import("../../shopify.server.js");
  }
  const module = await shopifyModulePromise;
  return module.default;
}

const ORDER_SYNC_CONCURRENCY = Number.parseInt(
  process.env.ORDER_SYNC_CONCURRENCY ?? "5",
  10,
);

export async function syncShopifyOrders({ store, session, days = 2, useRequestedLookback = false }) {
  if (!store?.id) {
    throw new Error("Store is required to sync Shopify orders");
  }
  if (!session) {
    throw new Error("Shopify admin session is required for order sync");
  }

  const { prismaClient, processShopifyOrder: processOrder } = getOrderSyncDependencies();
  const shopifyApi = await loadShopifyApi();

  const restClient = new shopifyApi.api.clients.Rest({ session });
  const processedAtMin = await determineStartDate(store.id, days, { useRequestedLookback });
  let cursor = null;
  let processed = 0;

  do {
    const response = await restClient.get({
      path: "orders.json",
      query: {
        status: "any",
        processed_at_min: processedAtMin.toISOString(),
        order: "processed_at asc",
        fields: ORDER_FIELDS,
        limit: 250,
        page_info: cursor ?? undefined,
      },
    });

    const orders = response.body?.orders ?? [];
    const concurrency = resolveConcurrency();
    for (let index = 0; index < orders.length; index += concurrency) {
      const batch = orders.slice(index, index + concurrency);
      await Promise.all(
        batch.map(async (payload) => {
          await processOrder({ store, payload });
          processed += 1;
        }),
      );
    }

    cursor = response.pageInfo?.nextPage?.query?.page_info ?? null;
  } while (cursor);

  return { processed, processedAtMin };
}

export async function syncOrderById({ store, session, orderId }) {
  if (!orderId) {
    throw new Error("orderId is required");
  }
  if (!session) {
    throw new Error("Shopify admin session is required");
  }

  const { processShopifyOrder: processOrder } = getOrderSyncDependencies();
  const shopifyApi = await loadShopifyApi();

  const restClient = new shopifyApi.api.clients.Rest({ session });
  const response = await restClient.get({
    path: `orders/${orderId}.json`,
    query: {
      fields: ORDER_FIELDS,
    },
  });

  const order = response.body?.order;
  if (!order) {
    throw new Error(`Order ${orderId} not found while syncing`);
  }

  await processOrder({ store, payload: order });
  return order;
}

async function determineStartDate(storeId, days, { useRequestedLookback = false } = {}) {
  const { prismaClient } = getOrderSyncDependencies();
  const latestOrder = await prismaClient.order.findFirst({
    where: { storeId },
    orderBy: { processedAt: "desc" },
  });

  const lookbackDays = resolveLookbackDays(days, {
    minimum: useRequestedLookback ? 1 : 14,
  });

  if (!latestOrder || useRequestedLookback) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - lookbackDays);
    return start;
  }

  const start = new Date(latestOrder.processedAt);
  start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

function resolveLookbackDays(value, { minimum = 14 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  return Math.max(normalized, minimum);
}

const ORDER_FIELDS = [
  "id",
  "name",
  "order_number",
  "processed_at",
  "current_total_price",
  "current_subtotal_price",
  "current_total_tax",
  "current_total_discounts",
  "currency",
  "presentment_currency",
  "source_name",
  "gateway",
  "payment_gateway_names",
  "financial_status",
  "subtotal_price",
  "total_price",
  "total_tax",
  "total_discounts",
  "shipping_lines",
  "total_shipping_price_set",
  "line_items",
  "customer",
  "discount_applications",
  "discount_codes",
  "tax_lines",
].join(",");

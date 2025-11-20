import defaultPrisma from "../../db.server.js";
import { processShopifyOrder as defaultProcessShopifyOrder } from "../profit-engine.server.js";
import { apiVersion as SHOPIFY_API_VERSION } from "../../shopify.server.js";

const DEFAULT_CONCURRENCY = Number.parseInt(
  process.env.ORDER_SYNC_CONCURRENCY ?? "5",
  10,
);

const REQUIRED_ORDER_SCOPES = ["read_orders"];

export class MissingShopifyScopeError extends Error {
  constructor(requiredScopes, grantedScopes, shop) {
    super(`Missing Shopify scopes: ${requiredScopes.join(", ")}`);
    this.name = "MissingShopifyScopeError";
    this.requiredScopes = requiredScopes;
    this.grantedScopes = grantedScopes;
    this.shop = shop;
  }
}

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
  return module.default ?? module.shopify ?? module;
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

  assertOrderScopes(session);

  const { prismaClient, processShopifyOrder: processOrder } = getOrderSyncDependencies();
  const shopifyApi = await loadShopifyApi();

  const restClient = createRestClient(shopifyApi, session);
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

  assertOrderScopes(session);

  const { processShopifyOrder: processOrder } = getOrderSyncDependencies();
  const shopifyApi = await loadShopifyApi();

  const restClient = createRestClient(shopifyApi, session);
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

function assertOrderScopes(session) {
  const granted = (session?.scope ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
  const missing = REQUIRED_ORDER_SCOPES.filter((scope) => !granted.includes(scope));
  if (missing.length > 0) {
    throw new MissingShopifyScopeError(missing, granted, session?.shop);
  }
}

function createRestClient(shopifyApi, session) {
  const api = shopifyApi?.api ?? shopifyApi;
  if (api?.clients?.Rest) {
    return new api.clients.Rest({ session });
  }
  if (api?.clients?.rest) {
    return new api.clients.rest({ session });
  }
  return createFetchRestClient(session);
}

function createFetchRestClient(session) {
  const version = typeof SHOPIFY_API_VERSION === "string" ? SHOPIFY_API_VERSION : String(SHOPIFY_API_VERSION);
  const baseUrl = `https://${session.shop}/admin/api/${version}`;

  return {
    async get({ path, query }) {
      const search = new URLSearchParams();
      Object.entries(query ?? {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          search.set(key, String(value));
        }
      });
      const url = `${baseUrl}/${path}${search.toString() ? `?${search.toString()}` : ""}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Shopify REST request failed (${response.status}): ${text || response.statusText}`);
      }

      const body = await response.json();
      const pageInfo = parseLinkHeaderForNextPage(response.headers.get("link"));
      return { body, pageInfo };
    },
  };
}

function parseLinkHeaderForNextPage(linkHeader) {
  if (!linkHeader) return undefined;

  const parts = linkHeader.split(",").map((part) => part.trim());
  for (const part of parts) {
    const match = part.match(/<([^>]+)>; rel="next"/i);
    if (!match) continue;
    const url = new URL(match[1]);
    const pageInfo = url.searchParams.get("page_info");
    if (pageInfo) {
      return { nextPage: { query: { page_info: pageInfo } } };
    }
  }
  return undefined;
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

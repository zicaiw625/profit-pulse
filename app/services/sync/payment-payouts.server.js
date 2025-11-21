import pkg from "@prisma/client";
import prisma from "../../db.server.js";
import { startSyncJob, finishSyncJob, failSyncJob } from "./jobs.server.js";
import { mapWithConcurrency } from "../../utils/concurrency.server.js";
import { fetchPaypalPayouts } from "../payments/paypal.server.js";
import { createScopedLogger, serializeError } from "../../utils/logger.server.js";
import { apiVersion as SHOPIFY_API_VERSION } from "../../shopify.server.js";

const { CredentialProvider, SyncJobType } = pkg;

const FALLBACK_EXTERNAL_PAYOUT_CONCURRENCY = 5;
const MAX_EXTERNAL_PAYOUT_CONCURRENCY = 10;

function sanitizeConcurrency(value) {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return FALLBACK_EXTERNAL_PAYOUT_CONCURRENCY;
  }
  return Math.min(numeric, MAX_EXTERNAL_PAYOUT_CONCURRENCY);
}

const DEFAULT_EXTERNAL_PAYOUT_CONCURRENCY = sanitizeConcurrency(
  process.env.PAYOUT_SYNC_CONCURRENCY ?? FALLBACK_EXTERNAL_PAYOUT_CONCURRENCY,
);

let externalPayoutConcurrency = DEFAULT_EXTERNAL_PAYOUT_CONCURRENCY;

const defaultDependencies = {
  fetchPaypalPayouts,
  persistExternalPayout: persistExternalPayoutRecord,
  startSyncJob,
  finishSyncJob,
  failSyncJob,
};

let paymentSyncDependencies = { ...defaultDependencies };
let shopifyModulePromise;

const payoutLogger = createScopedLogger({ service: "payment-payouts" });

export function setPaymentSyncDependenciesForTests(overrides = {}) {
  paymentSyncDependencies = { ...paymentSyncDependencies, ...overrides };
}

export function resetPaymentSyncDependenciesForTests() {
  paymentSyncDependencies = { ...defaultDependencies };
}

export function setExternalPayoutConcurrencyForTests(value) {
  externalPayoutConcurrency = sanitizeConcurrency(value);
}

export function resetExternalPayoutConcurrencyForTests() {
  externalPayoutConcurrency = DEFAULT_EXTERNAL_PAYOUT_CONCURRENCY;
}

function resolveExternalPayoutConcurrency() {
  return sanitizeConcurrency(externalPayoutConcurrency);
}

function getPaymentSyncDependencies() {
  return paymentSyncDependencies;
}

async function loadShopifyApi() {
  if (!shopifyModulePromise) {
    shopifyModulePromise = import("../../shopify.server.js");
  }
  const module = await shopifyModulePromise;
  // 兼容不同打包形态：default / shopify / 整个 module
  return module.default ?? module.shopify ?? module;
}

function createFetchRestClient(session) {
  const version =
    typeof SHOPIFY_API_VERSION === "string"
      ? SHOPIFY_API_VERSION
      : String(SHOPIFY_API_VERSION);
  const baseUrl = `https://${session.shop}/admin/api/${version}`;

  return {
    async get({ path, query }) {
      const search = new URLSearchParams();
      Object.entries(query ?? {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          search.set(key, String(value));
        }
      });

      const url = `${baseUrl}/${path}${
        search.toString() ? `?${search.toString()}` : ""
      }`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Shopify REST request failed (${response.status}): ${
            text || response.statusText
          }`,
        );
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

function createRestClient(shopifyApi, session) {
  const api = shopifyApi?.api ?? shopifyApi;

  if (api?.clients?.Rest) {
    return new api.clients.Rest({ session });
  }
  if (api?.clients?.rest) {
    return new api.clients.rest({ session });
  }

  // 2. 如果 SDK 上根本没有 REST client，就退回到我们手写的 fetch 版本
  return createFetchRestClient(session);
}

export async function syncShopifyPayments({ store, session, days = 7 }) {
  if (!store?.id) {
    throw new Error("Store is required");
  }
  if (!session) {
    throw new Error("Shopify admin session is required to sync payouts");
  }

  const { startSyncJob: startJob, finishSyncJob: finishJob, failSyncJob: failJob } =
    getPaymentSyncDependencies();

  const provider = CredentialProvider.SHOPIFY_PAYMENTS;
  const shopifyApi = await loadShopifyApi();
  const job = await startJob({
    storeId: store.id,
    jobType: SyncJobType.PAYMENT_PAYOUT,
    provider,
    metadata: { days },
  });

  try {
    payoutLogger.info("payments.sync.started", {
      context: { provider, storeId: store.id },
      days,
    });
    const restClient = createRestClient(shopifyApi, session);
    const payouts = await collectPayouts({ restClient, days });

    for (const payout of payouts) {
      const transactions = await fetchPayoutTransactions({ restClient, payoutId: payout.id });
      await prisma.paymentPayout.upsert({
        where: {
          storeId_payoutId: {
            storeId: store.id,
            payoutId: payout.id,
          },
        },
        create: mapPayout(store, payout, transactions),
        update: mapPayout(store, payout, transactions),
      });
    }

    await prisma.store.update({
      where: { id: store.id },
      data: { paymentsLastSyncedAt: new Date() },
    });

    await finishJob(job.id, {
      processedCount: payouts.length,
    });

    payoutLogger.info("payments.sync.completed", {
      context: { provider, storeId: store.id },
      days,
      processed: payouts.length,
    });

    return { processed: payouts.length };
  } catch (error) {
    payoutLogger.error("payments.sync.failed", {
      context: { provider, storeId: store.id },
      days,
      error: serializeError(error),
    });
    await failJob(job.id, error);
    throw error;
  }
}

export async function syncPaypalPayments({ store, days = 7 }) {
  if (!store?.id) {
    throw new Error("Store is required for PayPal sync");
  }

  const {
    fetchPaypalPayouts: fetchPaypal,
    persistExternalPayout: persistPayout,
    startSyncJob: startJob,
    finishSyncJob: finishJob,
    failSyncJob: failJob,
  } = getPaymentSyncDependencies();

  const provider = CredentialProvider.PAYPAL;
  const job = await startJob({
    storeId: store.id,
    jobType: SyncJobType.PAYMENT_PAYOUT,
    provider,
    metadata: { days },
  });

  try {
    payoutLogger.info("payments.sync.started", {
      context: { provider, storeId: store.id },
      days,
    });
    const payouts = await fetchPaypal({
      startDate: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      endDate: new Date(),
    });
    await mapWithConcurrency(
      payouts,
      resolveExternalPayoutConcurrency(),
      (payout) => persistPayout(store.id, CredentialProvider.PAYPAL, payout),
    );
    await finishJob(job.id, {
      processedCount: payouts.length,
    });

    payoutLogger.info("payments.sync.completed", {
      context: { provider, storeId: store.id },
      days,
      processed: payouts.length,
    });
    return { processed: payouts.length };
  } catch (error) {
    payoutLogger.error("payments.sync.failed", {
      context: { provider, storeId: store.id },
      days,
      error: serializeError(error),
    });
    await failJob(job.id, error);
    throw error;
  }
}

async function collectPayouts({ restClient, days }) {
  const minDate = new Date();
  minDate.setUTCDate(minDate.getUTCDate() - (Math.max(days, 1) - 1));
  let cursor = null;
  const payouts = [];

  do {
    const response = await restClient.get({
      path: "shopify_payments/payouts.json",
      query: {
        status: "paid",
        limit: 50,
        date_min: minDate.toISOString(),
        page_info: cursor ?? undefined,
      },
    });

    const batch = response.body?.payouts ?? [];
    payouts.push(...batch);
    cursor = response.pageInfo?.nextPage?.query?.page_info ?? null;
  } while (cursor);

  return payouts;
}

async function fetchPayoutTransactions({ restClient, payoutId }) {
  const response = await restClient.get({
    path: `shopify_payments/payouts/${payoutId}/transactions.json`,
    query: { limit: 250 },
  });
  return response.body?.transactions ?? [];
}

function mapPayout(store, payout, transactions) {
  const summary = payout.summary ?? {};
  const grossAmount = Number(
    summary.adjusted_gross_amount ?? payout.amount ?? 0,
  );
  const feeTotal = Number(summary.charges_fee_amount ?? 0) +
    Number(summary.adjustments_fee_amount ?? 0);
  const netAmount = Number(summary.net_amount ?? payout.net ?? payout.amount ?? 0);

  return {
    storeId: store.id,
    provider: CredentialProvider.SHOPIFY_PAYMENTS,
    payoutId: payout.id,
    status: payout.status,
    payoutDate: new Date(payout.arrival_date || payout.date || Date.now()),
    currency: payout.currency || store.currency,
    grossAmount,
    feeTotal,
    netAmount,
    transactions,
  };
}

async function persistExternalPayoutRecord(storeId, provider, payout) {
  const record = {
    storeId,
    provider,
    payoutId: payout.payoutId,
    status: payout.status ?? "PAID",
    payoutDate: payout.payoutDate instanceof Date ? payout.payoutDate : new Date(payout.payoutDate ?? Date.now()),
    currency: payout.currency ?? "USD",
    grossAmount: Number(payout.grossAmount ?? 0),
    feeTotal: Number(payout.feeTotal ?? 0),
    netAmount: Number(payout.netAmount ?? (Number(payout.grossAmount ?? 0) - Number(payout.feeTotal ?? 0))),
    transactions: payout.transactions ?? payout.metadata ?? payout.raw ?? null,
  };

  await prisma.paymentPayout.upsert({
    where: {
      storeId_payoutId: {
        storeId,
        payoutId: record.payoutId,
      },
    },
    create: record,
    update: record,
  });
}

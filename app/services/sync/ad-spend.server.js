import pkg from "@prisma/client";
import prisma from "../../db.server";
import { fetchMetaAdMetrics } from "../connectors/meta-ads.server";
import {
  parseCredentialSecret,
  ensureFreshAdAccessToken,
} from "../credentials.server";
import { startSyncJob, finishSyncJob, failSyncJob } from "./jobs.server";
import { formatDateKey, startOfDay } from "../../utils/dates.server.js";
import { getExchangeRate } from "../exchange-rates.server";
import { createScopedLogger, serializeError } from "../../utils/logger.server.js";

const { CredentialProvider, SyncJobType } = pkg;
const syncLogger = createScopedLogger({ service: "sync.ad-spend" });

const CONNECTORS = {
  META_ADS: ({ credential, secret, days }) =>
    fetchMetaAdMetrics({
      accountId: credential.accountId,
      secret,
      days,
    }),
};

export async function syncAdProvider({ store, provider, days = 7 }) {
  if (!store?.id) {
    throw new Error("Store is required to sync ad spend");
  }
  if (!CONNECTORS[provider]) {
    throw new Error(`Provider ${provider} is not supported yet`);
  }

  const credential = await prisma.adAccountCredential.findFirst({
    where: { storeId: store.id, provider },
  });

  if (!credential) {
    throw new Error(`No credentials for ${provider} on this store`);
  }

  const job = await startSyncJob({
    storeId: store.id,
    jobType: SyncJobType.AD_SPEND,
    provider,
    metadata: {
      accountId: credential.accountId,
      days,
    },
  });

  try {
    let secret = parseCredentialSecret(credential.encryptedSecret);
    ({ credential, secret } = await ensureFreshAdAccessToken({
      credential,
      secret,
    }));

    const records = await CONNECTORS[provider]({
      provider,
      credential,
      secret: { currency: store.currency, ...secret },
      days,
    });

    await upsertAdSpendRecords(store, provider, records);

    await prisma.adAccountCredential.update({
      where: { id: credential.id },
      data: { lastSyncedAt: new Date() },
    });

    await finishSyncJob(job.id, {
      processedCount: records.length,
      metadata: { days },
    });

    return {
      provider,
      processed: records.length,
    };
  } catch (error) {
    syncLogger.error("ad_provider_sync_failed", {
      storeId: store.id,
      provider,
      error: serializeError(error),
    });
    await failSyncJob(job.id, error);
    throw error;
  }
}

async function upsertAdSpendRecords(store, provider, records) {
  const storeId = store.id;
  const storeCurrency = store.currency ?? "USD";
  if (!records.length) return;

  const dailyTotals = new Map();
  const rateCache = new Map();

  async function convertSpend(amount, fromCurrency) {
    const numericAmount = Number(amount || 0);
    const base = (fromCurrency || storeCurrency).toUpperCase();
    const quote = storeCurrency.toUpperCase();
    if (!numericAmount || base === quote) {
      return numericAmount;
    }
    const cacheKey = `${base}->${quote}`;
    if (!rateCache.has(cacheKey)) {
      const rate = await getExchangeRate({ base, quote });
      rateCache.set(cacheKey, rate);
    }
    return numericAmount * Number(rateCache.get(cacheKey) || 1);
  }

  for (const record of records) {
    const compositeKey = buildCompositeKey(storeId, provider, record);
    await prisma.adSpendRecord.upsert({
      where: { compositeKey },
      create: {
        storeId,
        provider,
        compositeKey,
        ...mapRecordFields(record),
      },
      update: {
        ...mapRecordFields(record),
      },
    });

    const dateKey = formatDateKey(record.date);
    const convertedSpend = await convertSpend(record.spend, record.currency);
    const existing = dailyTotals.get(dateKey) || {
      convertedSpend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      currency: storeCurrency,
    };
    existing.convertedSpend += convertedSpend;
    existing.impressions += record.impressions;
    existing.clicks += record.clicks;
    existing.conversions += record.conversions;
    dailyTotals.set(dateKey, existing);
  }

  for (const [dateKey, totals] of dailyTotals.entries()) {
    const date = new Date(dateKey);
    await applyAdSpendToMetrics({
      storeId,
      provider,
      date,
      totals,
      storeCurrency,
    });
  }
}

function mapRecordFields(record) {
  return {
    accountId: record.accountId,
    campaignId: record.campaignId,
    campaignName: record.campaignName,
    adSetId: record.adSetId,
    adSetName: record.adSetName,
    adId: record.adId,
    adName: record.adName,
    date: record.date,
    currency: record.currency,
    spend: record.spend,
    impressions: record.impressions,
    clicks: record.clicks,
    conversions: record.conversions,
  };
}

async function applyAdSpendToMetrics({
  storeId,
  provider,
  date,
  totals,
  storeCurrency,
}) {
  const channelKey = toChannel(provider);
  const metricDate = startOfDay(date);
  const spendAmount = Number(totals.convertedSpend ?? totals.spend ?? 0);
  const metricCurrency = totals.currency ?? storeCurrency ?? "USD";
  await prisma.$transaction([
    prisma.dailyMetric.upsert({
      where: {
        storeId_channel_productSku_date: {
          storeId,
          channel: "TOTAL",
          productSku: null,
          date: metricDate,
        },
      },
      create: {
        storeId,
        channel: "TOTAL",
        productSku: null,
        date: metricDate,
        currency: metricCurrency,
        orders: 0,
        units: 0,
        revenue: 0,
        cogs: 0,
        shippingCost: 0,
        paymentFees: 0,
        grossProfit: 0,
        netProfit: 0,
        adSpend: spendAmount,
      },
      update: {
        adSpend: { increment: spendAmount },
      },
    }),
    prisma.dailyMetric.upsert({
      where: {
        storeId_channel_productSku_date: {
          storeId,
          channel: channelKey,
          productSku: null,
          date: metricDate,
        },
      },
      create: {
        storeId,
        channel: channelKey,
        productSku: null,
        date: metricDate,
        currency: metricCurrency,
        adSpend: spendAmount,
        revenue: 0,
        orders: 0,
        units: 0,
        cogs: 0,
        shippingCost: 0,
        paymentFees: 0,
        grossProfit: 0,
        netProfit: 0,
      },
      update: {
        adSpend: { increment: spendAmount },
      },
    }),
  ]);
}

function toChannel(provider) {
  if (provider === CredentialProvider.META_ADS) {
    return "META_ADS";
  }
  return provider;
}

function buildCompositeKey(storeId, provider, record) {
  return [
    storeId,
    record.date instanceof Date ? record.date.toISOString().slice(0, 10) : record.date,
    provider,
    record.campaignId ?? "campaign",
    record.adSetId ?? "adset",
    record.adId ?? "ad",
  ].join(":");
}

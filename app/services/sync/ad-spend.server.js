import pkg from "@prisma/client";
import prisma from "../../db.server";
import { fetchMetaAdMetrics } from "../connectors/meta-ads.server";
import { fetchGoogleAdMetrics } from "../connectors/google-ads.server";
import { parseCredentialSecret } from "../credentials.server";
import { startSyncJob, finishSyncJob, failSyncJob } from "./jobs.server";
import { formatDateKey, startOfDay } from "../../utils/dates.server.js";

const { CredentialProvider, SyncJobType } = pkg;

const CONNECTORS = {
  META_ADS: ({ credential, secret, days }) =>
    fetchMetaAdMetrics({
      accountId: credential.accountId,
      secret,
      days,
    }),
  GOOGLE_ADS: ({ credential, secret, days }) =>
    fetchGoogleAdMetrics({
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
    const secret = parseCredentialSecret(credential.encryptedSecret);
    const records = await CONNECTORS[provider]({
      provider,
      credential,
      secret: { currency: store.currency, ...secret },
      days,
    });

    await upsertAdSpendRecords(store.id, provider, records);

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
    await failSyncJob(job.id, error);
    throw error;
  }
}

async function upsertAdSpendRecords(storeId, provider, records) {
  if (!records.length) return;

  const dailyTotals = new Map();

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
    const existing = dailyTotals.get(dateKey) || {
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      currency: record.currency,
    };
    existing.spend += record.spend;
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

async function applyAdSpendToMetrics({ storeId, provider, date, totals }) {
  const channelKey = toChannel(provider);
  const metricDate = startOfDay(date);
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
        currency: totals.currency,
        orders: 0,
        units: 0,
        revenue: 0,
        cogs: 0,
        shippingCost: 0,
        paymentFees: 0,
        grossProfit: 0,
        netProfit: 0,
        adSpend: totals.spend,
      },
      update: {
        adSpend: { increment: totals.spend },
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
        currency: totals.currency,
        adSpend: totals.spend,
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
        adSpend: { increment: totals.spend },
      },
    }),
  ]);
}

function toChannel(provider) {
  switch (provider) {
    case CredentialProvider.META_ADS:
      return "META_ADS";
    case CredentialProvider.GOOGLE_ADS:
      return "GOOGLE_ADS";
    default:
      return provider;
  }
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

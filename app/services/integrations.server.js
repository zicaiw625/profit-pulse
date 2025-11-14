import pkg from "@prisma/client";
import prisma from "../db.server";
import { LOGISTICS_PROVIDERS } from "./logistics-integrations.server";

const { CredentialProvider, SyncJobType } = pkg;

const AD_PROVIDERS = [
  {
    id: CredentialProvider.META_ADS,
    label: "Meta Ads",
    requiresCredential: true,
  },
  {
    id: CredentialProvider.GOOGLE_ADS,
    label: "Google Ads",
    requiresCredential: true,
  },
  {
    id: CredentialProvider.BING_ADS,
    label: "Bing Ads",
    requiresCredential: true,
  },
  {
    id: CredentialProvider.TIKTOK_ADS,
    label: "TikTok Ads",
    requiresCredential: true,
  },
  {
    id: CredentialProvider.AMAZON_ADS,
    label: "Amazon Ads",
    requiresCredential: true,
  },
  {
    id: CredentialProvider.SNAPCHAT_ADS,
    label: "Snapchat Ads",
    requiresCredential: true,
  },
];

const PAYMENT_PROVIDERS = [
  {
    id: CredentialProvider.SHOPIFY_PAYMENTS,
    label: "Shopify Payments",
    requiresCredential: false,
  },
  {
    id: CredentialProvider.PAYPAL,
    label: "PayPal",
    requiresCredential: false,
  },
  {
    id: CredentialProvider.STRIPE,
    label: "Stripe payouts",
    requiresCredential: false,
  },
  {
    id: CredentialProvider.KLARNA,
    label: "Klarna payouts",
    requiresCredential: false,
  },
];

export async function getIntegrationStatus(storeId) {
  const [credentials, logisticsCredentials, jobs, store, latestOrder, latestPayouts] =
    await Promise.all([
      prisma.adAccountCredential.findMany({
        where: { storeId },
      }),
      prisma.logisticsCredential.findMany({
        where: { storeId },
      }),
      prisma.syncJob.findMany({
        where: { storeId },
        orderBy: { startedAt: "desc" },
        take: 20,
      }),
      prisma.store.findUnique({ where: { id: storeId } }),
      prisma.order.findFirst({
        where: { storeId },
        orderBy: { processedAt: "desc" },
        select: { processedAt: true },
      }),
      prisma.paymentPayout.findMany({
        where: { storeId },
        orderBy: { payoutDate: "desc" },
        take: 5,
      }),
    ]);

  const credentialByProvider = credentials.reduce((acc, credential) => {
    acc[credential.provider] = credential;
    return acc;
  }, {});

  const latestJobByProvider = jobs.reduce((acc, job) => {
    const key = job.provider ?? `${job.jobType}`;
    if (!acc[key]) {
      acc[key] = job;
    }
    return acc;
  }, {});

  const logisticsCredentialByProvider = logisticsCredentials.reduce(
    (acc, credential) => {
      acc[credential.provider] = credential;
      return acc;
    },
    {},
  );

  const adIntegrations = AD_PROVIDERS.map((provider) => {
    const credential = credentialByProvider[provider.id];
    const job = latestJobByProvider[provider.id];
    return {
      id: provider.id,
      label: provider.label,
      status: credential ? "Connected" : "Not connected",
      lastSyncedAt: credential?.lastSyncedAt ?? job?.completedAt ?? null,
      credentialId: credential?.id ?? null,
      accountName: credential?.accountName ?? null,
      accountId: credential?.accountId ?? null,
      requiresCredential: provider.requiresCredential,
    };
  });

  const paymentIntegrations = PAYMENT_PROVIDERS.map((provider) => {
    const jobKey = `${SyncJobType.PAYMENT_PAYOUT}`;
    const job = latestJobByProvider[provider.id] ?? latestJobByProvider[jobKey];
    const payout = latestPayouts.find((p) => p.provider === provider.id);
    return {
      id: provider.id,
      label: provider.label,
      status:
        provider.id === CredentialProvider.SHOPIFY_PAYMENTS
          ? store?.paymentsLastSyncedAt
            ? "Active"
            : "Not synced"
          : payout
            ? "Active"
            : "Not synced",
      lastSyncedAt:
        provider.id === CredentialProvider.SHOPIFY_PAYMENTS
          ? store?.paymentsLastSyncedAt ?? job?.completedAt ?? null
          : payout?.payoutDate ?? job?.completedAt ?? null,
    };
  });

  const logisticsIntegrations = LOGISTICS_PROVIDERS.map((provider) => {
    const credential = logisticsCredentialByProvider[provider.id];
    const job = latestJobByProvider[provider.id];
    return {
      id: provider.id,
      label: provider.label,
      status: credential ? "Connected" : "Not connected",
      lastSyncedAt: credential?.lastSyncedAt ?? job?.completedAt ?? null,
      credentialId: credential?.id ?? null,
      accountName: credential?.accountName ?? null,
      accountId: credential?.accountId ?? null,
      requiresCredential: true,
    };
  });

  return {
    ads: adIntegrations,
    logistics: logisticsIntegrations,
    payments: paymentIntegrations,
    shopify: {
      id: "SHOPIFY",
      label: "Shopify data",
      status: latestOrder ? "Active" : "Awaiting sync",
      lastSyncedAt: latestOrder?.processedAt ?? null,
    },
  };
}

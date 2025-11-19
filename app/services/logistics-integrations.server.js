import pkg from "@prisma/client";
import prisma from "../db.server";
// TODO: enable when logistics integrations are ready for public launch.
import { parseLogisticsCredentialSecret } from "./logistics-credentials.server";
import { replaceLogisticsRulesFromRates } from "./logistics.server";
import { startSyncJob, finishSyncJob, failSyncJob } from "./sync/jobs.server";
import { fetchEasyPostLogisticsRates } from "./connectors/easypost-logistics.server";
import { fetchShipStationLogisticsRates } from "./connectors/shipstation-logistics.server";

const { CredentialProvider, SyncJobType } = pkg;

export const LOGISTICS_PROVIDERS = [
  {
    id: CredentialProvider.EASYPOST_LOGISTICS,
    label: "EasyPost",
  },
  {
    id: CredentialProvider.SHIPSTATION_LOGISTICS,
    label: "ShipStation",
  },
];

const CONNECTORS = {
  [CredentialProvider.EASYPOST_LOGISTICS]: fetchEasyPostLogisticsRates,
  [CredentialProvider.SHIPSTATION_LOGISTICS]: fetchShipStationLogisticsRates,
};

export async function syncLogisticsProvider({ storeId, provider, defaultCurrency }) {
  if (!storeId || !provider) {
    throw new Error("storeId and provider are required to sync logistics");
  }
  const connector = CONNECTORS[provider];
  if (!connector) {
    throw new Error(`No logistics connector registered for ${provider}`);
  }

  const credential = await prisma.logisticsCredential.findFirst({
    where: { storeId, provider },
  });

  if (!credential) {
    throw new Error(`No credentials configured for ${provider}`);
  }

  const job = await startSyncJob({
    storeId,
    jobType: SyncJobType.LOGISTICS_RATE,
    provider,
    metadata: {
      accountId: credential.accountId,
    },
  });

  try {
    const secret = parseLogisticsCredentialSecret(credential.encryptedSecret);
    const rates = await connector({
      secret,
      currency: defaultCurrency,
    });

    const inserted = await replaceLogisticsRulesFromRates({
      storeId,
      provider: credential.provider,
      rates,
      defaultCurrency,
    });

    await prisma.logisticsCredential.update({
      where: { id: credential.id },
      data: { lastSyncedAt: new Date() },
    });

    await finishSyncJob(job.id, {
      processedCount: inserted,
      metadata: {
        provider,
        inserted,
      },
    });

    return { provider, processed: inserted };
  } catch (error) {
    await failSyncJob(job.id, error);
    throw error;
  }
}

export async function describeLogisticsIntegrations(storeId) {
  if (!storeId) {
    return LOGISTICS_PROVIDERS.map((provider) => ({
      id: provider.id,
      label: provider.label,
      status: "Not connected",
      lastSyncedAt: null,
      accountName: null,
      accountId: null,
    }));
  }

  const [credentials, jobs] = await Promise.all([
    prisma.logisticsCredential.findMany({ where: { storeId } }),
    prisma.syncJob.findMany({
      where: { storeId, jobType: SyncJobType.LOGISTICS_RATE },
      orderBy: { startedAt: "desc" },
      take: 20,
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

  return LOGISTICS_PROVIDERS.map((provider) => {
    const credential = credentialByProvider[provider.id];
    const job = latestJobByProvider[provider.id];
    return {
      id: provider.id,
      label: provider.label,
      status: credential ? "Connected" : "Not connected",
      lastSyncedAt: credential?.lastSyncedAt ?? job?.completedAt ?? null,
      accountName: credential?.accountName ?? null,
      accountId: credential?.accountId ?? null,
    };
  });
}

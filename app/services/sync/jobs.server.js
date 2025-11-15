import pkg from "@prisma/client";
import prisma from "../../db.server.js";

const { SyncJobType, SyncJobStatus, CredentialProvider } = pkg;

export async function startSyncJob({
  storeId,
  jobType,
  provider = null,
  metadata = {},
}) {
  if (!storeId) {
    throw new Error("storeId is required to start a sync job");
  }

  const job = await prisma.syncJob.create({
    data: {
      storeId,
      jobType,
      provider: provider ?? null,
      status: SyncJobStatus.RUNNING,
      metadata,
    },
  });

  return job;
}

export async function finishSyncJob(jobId, { status, processedCount, message, metadata }) {
  if (!jobId) {
    throw new Error("jobId is required to finish a sync job");
  }

  const data = {
    status: status ?? SyncJobStatus.SUCCESS,
    processedCount:
      typeof processedCount === "number" ? processedCount : undefined,
    message: message ?? undefined,
    metadata: metadata ?? undefined,
    completedAt: new Date(),
  };

  return prisma.syncJob.update({
    where: { id: jobId },
    data,
  });
}

export async function failSyncJob(jobId, error) {
  return finishSyncJob(jobId, {
    status: SyncJobStatus.FAILED,
    message: error instanceof Error ? error.message : String(error),
  });
}

export function listJobTypeOptions() {
  return Object.values(SyncJobType);
}

export function listProviderOptions() {
  return Object.values(CredentialProvider);
}

import pkg from "@prisma/client";
import prisma from "../db.server";
import { encryptSensitiveString } from "../utils/security.server";
import { parseCredentialSecret } from "./credentials.server";

const { CredentialProvider } = pkg;

function serializeSecret(secret) {
  try {
    return JSON.stringify(secret ?? {});
  } catch (error) {
    throw new Error("Unable to serialize logistics credential secret");
  }
}

export const parseLogisticsCredentialSecret = parseCredentialSecret;

export async function listLogisticsCredentials(storeId) {
  if (!storeId) return [];
  return prisma.logisticsCredential.findMany({
    where: { storeId },
    orderBy: { createdAt: "asc" },
  });
}

export async function upsertLogisticsCredential({
  merchantId,
  storeId,
  provider,
  accountId,
  accountName,
  secret,
}) {
  if (!merchantId || !storeId || !provider) {
    throw new Error(
      "merchantId, storeId, and provider are required to connect logistics credentials",
    );
  }
  if (!CredentialProvider[provider]) {
    throw new Error(`Unsupported logistics provider: ${provider}`);
  }

  const serializedSecret = serializeSecret(secret);
  const encryptedPayload = encryptSensitiveString(serializedSecret);

  const payload = {
    merchantId,
    storeId,
    provider,
    accountId: accountId ?? null,
    accountName: accountName ?? null,
    encryptedSecret: encryptedPayload,
  };

  const existing = await prisma.logisticsCredential.findFirst({
    where: { merchantId, storeId, provider },
  });

  if (existing) {
    return prisma.logisticsCredential.update({
      where: { id: existing.id },
      data: payload,
    });
  }

  return prisma.logisticsCredential.create({ data: payload });
}

export async function deleteLogisticsCredential({ merchantId, storeId, provider }) {
  if (!merchantId || !storeId || !provider) {
    throw new Error(
      "merchantId, storeId, and provider are required to remove logistics credentials",
    );
  }

  await prisma.logisticsCredential.deleteMany({
    where: { merchantId, storeId, provider },
  });
}

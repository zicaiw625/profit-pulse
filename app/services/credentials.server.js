import pkg from "@prisma/client";
import prisma from "../db.server";
import {
  decryptSensitiveString,
  encryptSensitiveString,
} from "../utils/security.server";

const { CredentialProvider } = pkg;

export function parseCredentialSecret(encryptedSecret) {
  if (!encryptedSecret) {
    return {};
  }

  try {
    const serialized = decryptSensitiveString(encryptedSecret) ?? encryptedSecret;
    return JSON.parse(serialized);
  } catch (error) {
    try {
      return JSON.parse(encryptedSecret);
    } catch (fallbackError) {
      return { accessToken: encryptedSecret };
    }
  }
}

export function requireAccessToken(secret, providerLabel) {
  const token = secret?.accessToken;
  if (!token) {
    throw new Error(
      `Missing access token for ${providerLabel}. Update the credential and try again.`,
    );
  }
  return token;
}

export async function upsertAdCredential({
  merchantId,
  storeId,
  provider,
  accountId,
  accountName,
  secret,
  scopes,
  expiresAt,
}) {
  if (!merchantId || !storeId || !provider) {
    throw new Error("merchantId, storeId, and provider are required to connect ad credentials");
  }

  if (!CredentialProvider[provider]) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const serializedSecret = JSON.stringify(secret ?? {});
  let encryptedPayload;
  try {
    encryptedPayload = encryptSensitiveString(serializedSecret);
  } catch (error) {
    throw new Error(
      "Failed to encrypt credential secret. Ensure CREDENTIAL_ENCRYPTION_KEY is configured.",
    );
  }

  const payload = {
    merchantId,
    storeId,
    provider,
    accountId,
    accountName,
    encryptedSecret: encryptedPayload,
    scopes: scopes ?? null,
    expiresAt: expiresAt ?? null,
  };

  const existing = await prisma.adAccountCredential.findFirst({
    where: { storeId, provider },
  });

  if (existing) {
    return prisma.adAccountCredential.update({
      where: { id: existing.id },
      data: payload,
    });
  }

  return prisma.adAccountCredential.create({ data: payload });
}

export async function deleteAdCredential({ merchantId, storeId, provider }) {
  if (!merchantId || !storeId || !provider) {
    throw new Error("merchantId, storeId, and provider are required to remove credentials");
  }

  await prisma.adAccountCredential.deleteMany({
    where: { merchantId, storeId, provider },
  });
}

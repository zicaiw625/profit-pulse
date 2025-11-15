import pkg from "@prisma/client";
import prisma from "../db.server.js";
import { logger } from "../utils/logger.server.js";
import {
  decryptSensitiveString,
  encryptSensitiveString,
} from "../utils/security.server.js";
import {
  refreshGoogleAdsAccessToken,
} from "./oauth/google-ads.server.js";
import { extendMetaAccessToken, META_ADS_SCOPE } from "./oauth/meta-ads.server.js";

const { CredentialProvider } = pkg;

let credentialPrisma = prisma;
let credentialLogger = logger.child({ service: "credentials" });
let credentialTokenRefresher;

function resolveRefreshConcurrency() {
  const parsed = Number.parseInt(
    process.env.CREDENTIAL_REFRESH_CONCURRENCY ?? "5",
    10,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5;
  }
  return parsed;
}

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

  const existing = await credentialPrisma.adAccountCredential.findFirst({
    where: { storeId, provider },
  });

  if (existing) {
    return credentialPrisma.adAccountCredential.update({
      where: { id: existing.id },
      data: payload,
    });
  }

  return credentialPrisma.adAccountCredential.create({ data: payload });
}

export async function deleteAdCredential({ merchantId, storeId, provider }) {
  if (!merchantId || !storeId || !provider) {
    throw new Error("merchantId, storeId, and provider are required to remove credentials");
  }

  await credentialPrisma.adAccountCredential.deleteMany({
    where: { merchantId, storeId, provider },
  });
}

const PROVIDER_REFRESH_MARGIN = {
  META_ADS: 1000 * 60 * 60 * 72, // 72 hours
};

function needsTokenRefresh(credential) {
  const expiresAt = credential?.expiresAt ? new Date(credential.expiresAt) : null;
  if (!expiresAt) {
    return true;
  }
  const margin =
    PROVIDER_REFRESH_MARGIN[credential.provider] ?? 1000 * 60 * 5; // 5 minutes
  return expiresAt.getTime() - Date.now() <= margin;
}

const REFRESH_HANDLERS = {
  [CredentialProvider.GOOGLE_ADS]: async ({ credential, secret }) => {
    if (!secret.refreshToken) {
      throw new Error("Google Ads credential is missing refresh token");
    }
    const refreshed = await refreshGoogleAdsAccessToken(secret.refreshToken);
    return {
      secret: {
        ...secret,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        tokenType: refreshed.tokenType ?? secret.tokenType,
      },
      expiresAt: refreshed.expiresAt ?? null,
      scopes: refreshed.scope ?? credential.scopes,
    };
  },
  [CredentialProvider.META_ADS]: async ({ secret, credential }) => {
    const currentToken = secret.accessToken;
    if (!currentToken) {
      throw new Error("Meta Ads credential is missing access token");
    }
    const refreshed = await extendMetaAccessToken(currentToken);
    return {
      secret: {
        ...secret,
        accessToken: refreshed.accessToken,
      },
      expiresAt: refreshed.expiresAt ?? null,
      scopes: META_ADS_SCOPE,
    };
  },
};

export async function ensureFreshAdAccessToken({ credential, secret }) {
  if (!credential) {
    return { credential: null, secret: secret ?? {} };
  }

  const parsedSecret = secret ?? parseCredentialSecret(credential.encryptedSecret);
  if (!needsTokenRefresh(credential)) {
    return { credential, secret: parsedSecret };
  }

  const handler = REFRESH_HANDLERS[credential.provider];
  if (!handler) {
    return { credential, secret: parsedSecret };
  }

  const refreshed = await handler({ credential, secret: parsedSecret });

  const updated = await upsertAdCredential({
    merchantId: credential.merchantId,
    storeId: credential.storeId,
    provider: credential.provider,
    accountId: credential.accountId,
    accountName: credential.accountName ?? undefined,
    secret: refreshed.secret,
    scopes: refreshed.scopes ?? credential.scopes,
    expiresAt: refreshed.expiresAt ?? null,
  });

  return { credential: updated, secret: refreshed.secret };
}

export async function refreshExpiringAdCredentials({ marginMinutes = 60 } = {}) {
  const marginMs = Math.max(0, Number(marginMinutes) || 0) * 60 * 1000;
  const threshold = new Date(Date.now() + marginMs);

  const candidates = await credentialPrisma.adAccountCredential.findMany({
    where: {
      provider: { in: [CredentialProvider.GOOGLE_ADS, CredentialProvider.META_ADS] },
      OR: [
        { expiresAt: null },
        { expiresAt: { lte: threshold } },
      ],
    },
  });

  if (!candidates.length) {
    return 0;
  }

  const concurrency = resolveRefreshConcurrency();
  const refreshFn = credentialTokenRefresher ?? ensureFreshAdAccessToken;

  let refreshedCount = 0;
  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    const results = await Promise.all(
      batch.map(async (credential) => {
        try {
          await refreshFn({ credential });
          return true;
        } catch (error) {
          credentialLogger.error("Failed to refresh credential", {
            context: {
              credentialId: credential.id,
              provider: credential.provider,
              merchantId: credential.merchantId,
              storeId: credential.storeId,
            },
            error: error instanceof Error ? error.message : error,
          });
          return false;
        }
      }),
    );
    refreshedCount += results.filter(Boolean).length;
  }

  return refreshedCount;
}

export function setCredentialServiceDependenciesForTests(overrides) {
  if (!overrides) {
    credentialPrisma = prisma;
    credentialLogger = logger.child({ service: "credentials" });
    credentialTokenRefresher = undefined;
    return;
  }

  const { prisma: prismaOverride, logger: loggerOverride, tokenRefresher } = overrides;
  credentialPrisma = prismaOverride ?? prisma;
  credentialLogger =
    loggerOverride ?? logger.child({ service: "credentials", test: true });
  credentialTokenRefresher = tokenRefresher ?? undefined;
}

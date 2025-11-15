import prisma from "../db.server";
import { parseSignedState } from "../utils/oauth-state.server.js";
import { logAuditEvent } from "../services/audit.server";
import {
  exchangeMetaAdsCode,
  META_ADS_SCOPE,
} from "../services/oauth/meta-ads.server.js";
import { parseCredentialSecret, upsertAdCredential } from "../services/credentials.server";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const oauthLogger = createScopedLogger({ route: "auth.meta-ads.callback" });

function buildSettingsRedirect({ provider, status, message }) {
  const url = new URL("/app/settings", "http://localhost");
  url.searchParams.set("oauth", provider);
  url.searchParams.set("status", status);
  if (message) {
    url.searchParams.set("message", message);
  }
  const location = `${url.pathname}?${url.searchParams.toString()}`;
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}

function resolveAbsoluteUrl(pathname) {
  const baseUrl = process.env.SHOPIFY_APP_URL;
  if (!baseUrl) {
    throw new Error("SHOPIFY_APP_URL is not configured");
  }
  return new URL(pathname, baseUrl).toString();
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    const message = url.searchParams.get("error_description") || error;
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message,
    });
  }

  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");

  let state;
  try {
    state = parseSignedState(stateToken);
  } catch (parseError) {
    oauthLogger.error("meta_ads_oauth_state_invalid", {
      error: serializeError(parseError),
      stateToken,
    });
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message: "授权回调校验失败，请重试。",
    });
  }

  if (!code) {
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message: "缺少 Meta 授权码，请重试。",
    });
  }

  if (state.provider !== "META_ADS") {
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message: "授权目标不匹配，请重新发起。",
    });
  }

  const store = await prisma.store.findUnique({ where: { id: state.storeId } });
  if (!store || store.merchantId !== state.merchantId) {
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message: "无法匹配店铺，请重新发起授权。",
    });
  }

  try {
    const redirectUri = resolveAbsoluteUrl("/auth/meta-ads/callback");
    const tokenResult = await exchangeMetaAdsCode({ code, redirectUri });

    const existing = await prisma.adAccountCredential.findFirst({
      where: { storeId: store.id, provider: "META_ADS" },
    });
    const existingSecret = existing
      ? parseCredentialSecret(existing.encryptedSecret)
      : {};

    const secret = {
      accessToken: tokenResult.accessToken,
    };

    if (existingSecret.refreshToken) {
      secret.refreshToken = existingSecret.refreshToken;
    }

    await upsertAdCredential({
      merchantId: state.merchantId,
      storeId: store.id,
      provider: "META_ADS",
      accountId: state.accountId,
      accountName: state.accountName || undefined,
      secret,
      scopes: META_ADS_SCOPE,
      expiresAt: tokenResult.expiresAt ?? null,
    });

    await logAuditEvent({
      merchantId: state.merchantId,
      userEmail: state.userEmail ?? null,
      action: "connect_ad_credential",
      details: `Connected Meta Ads account ${state.accountId}`,
    });

    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "success",
      message: "Meta Ads 已成功授权。",
    });
  } catch (error) {
    oauthLogger.error("meta_ads_oauth_callback_failed", {
      merchantId: state?.merchantId,
      storeId: state?.storeId,
      accountId: state?.accountId,
      error: serializeError(error),
    });
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message: error.message ?? "Meta Ads 授权失败，请重试。",
    });
  }
};

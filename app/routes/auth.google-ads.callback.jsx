import prisma from "../db.server";
import { parseCredentialSecret, upsertAdCredential } from "../services/credentials.server";
import {
  exchangeGoogleAdsCode,
  getGoogleDeveloperToken,
  GOOGLE_ADS_SCOPE,
} from "../services/oauth/google-ads.server.js";
import { parseSignedState } from "../utils/oauth-state.server.js";
import { logAuditEvent } from "../services/audit.server";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const oauthLogger = createScopedLogger({ route: "auth.google-ads.callback" });

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
      provider: "google-ads",
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
    oauthLogger.error("google_ads_oauth_state_invalid", {
      error: serializeError(parseError),
      stateToken,
    });
    return buildSettingsRedirect({
      provider: "google-ads",
      status: "error",
      message: "授权回调校验失败，请重试。",
    });
  }

  if (!code) {
    return buildSettingsRedirect({
      provider: "google-ads",
      status: "error",
      message: "缺少 Google 授权码，请重试。",
    });
  }

  if (state.provider !== "GOOGLE_ADS") {
    return buildSettingsRedirect({
      provider: "google-ads",
      status: "error",
      message: "授权目标不匹配，请重新发起。",
    });
  }

  const store = await prisma.store.findUnique({ where: { id: state.storeId } });
  if (!store || store.merchantId !== state.merchantId) {
    return buildSettingsRedirect({
      provider: "google-ads",
      status: "error",
      message: "无法匹配店铺，请重新发起授权。",
    });
  }

  try {
    const redirectUri = resolveAbsoluteUrl("/auth/google-ads/callback");
    const tokenResult = await exchangeGoogleAdsCode({ code, redirectUri });
    const developerToken = getGoogleDeveloperToken();

    const existing = await prisma.adAccountCredential.findFirst({
      where: { storeId: store.id, provider: "GOOGLE_ADS" },
    });
    const existingSecret = existing
      ? parseCredentialSecret(existing.encryptedSecret)
      : {};

    const secret = {
      accessToken: tokenResult.accessToken,
      developerToken,
      ...(state.loginCustomerId ? { loginCustomerId: state.loginCustomerId } : {}),
      ...(tokenResult.tokenType ? { tokenType: tokenResult.tokenType } : {}),
    };

    const refreshToken = tokenResult.refreshToken || existingSecret.refreshToken;
    if (refreshToken) {
      secret.refreshToken = refreshToken;
    } else {
      throw new Error("Google OAuth 未返回 Refresh Token，请确认首次授权并勾选离线访问。");
    }

    await upsertAdCredential({
      merchantId: state.merchantId,
      storeId: store.id,
      provider: "GOOGLE_ADS",
      accountId: state.accountId,
      accountName: state.accountName || undefined,
      secret,
      scopes: tokenResult.scope || GOOGLE_ADS_SCOPE,
      expiresAt: tokenResult.expiresAt ?? null,
    });

    await logAuditEvent({
      merchantId: state.merchantId,
      userEmail: state.userEmail ?? null,
      action: "connect_ad_credential",
      details: `Connected Google Ads account ${state.accountId}`,
    });

    return buildSettingsRedirect({
      provider: "google-ads",
      status: "success",
      message: "Google Ads 已成功授权。",
    });
  } catch (error) {
    oauthLogger.error("google_ads_oauth_callback_failed", {
      merchantId: state?.merchantId,
      storeId: state?.storeId,
      accountId: state?.accountId,
      error: serializeError(error),
    });
    return buildSettingsRedirect({
      provider: "google-ads",
      status: "error",
      message: error.message ?? "Google Ads 授权失败，请重试。",
    });
  }
};

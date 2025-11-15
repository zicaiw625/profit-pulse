import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { buildMetaAdsAuthorizationUrl } from "../services/oauth/meta-ads.server.js";
import { createSignedState } from "../utils/oauth-state.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const oauthLogger = createScopedLogger({ route: "auth.meta-ads.start" });

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

function normalizeAccountId(raw) {
  if (!raw) return null;
  const trimmed = raw.toString().trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("act_")) {
    return trimmed;
  }
  const digits = trimmed.replace(/[^0-9]/g, "");
  return digits ? `act_${digits}` : null;
}

function resolveAbsoluteUrl(pathname) {
  const baseUrl = process.env.SHOPIFY_APP_URL;
  if (!baseUrl) {
    throw new Error("SHOPIFY_APP_URL is not configured");
  }
  return new URL(pathname, baseUrl).toString();
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const formData = await request.formData();
  const accountId = normalizeAccountId(formData.get("accountId"));
  const accountName = formData.get("accountName")?.toString().trim() || undefined;

  if (!accountId) {
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message: "请提供 Meta 广告账号 ID (act_123456789)。",
    });
  }

  try {
    const state = createSignedState({
      provider: "META_ADS",
      merchantId: store.merchantId,
      storeId: store.id,
      accountId,
      accountName: accountName ?? null,
      userEmail: session.email ?? null,
      redirectPath: "/app/settings",
    });

    const redirectUri = resolveAbsoluteUrl("/auth/meta-ads/callback");
    const authorizationUrl = buildMetaAdsAuthorizationUrl({ state, redirectUri });

    return new Response(null, {
      status: 302,
      headers: { Location: authorizationUrl },
    });
  } catch (error) {
    oauthLogger.error("meta_ads_oauth_start_failed", {
      error: serializeError(error),
    });
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message: "无法启动 Meta 授权，请检查应用配置。",
    });
  }
};

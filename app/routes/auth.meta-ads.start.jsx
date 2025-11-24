import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { buildMetaAdsAuthorizationUrl } from "../services/oauth/meta-ads.server.js";
import { createSignedState } from "../utils/oauth-state.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";
import { getEnvVar } from "../utils/env.server.js";

const oauthLogger = createScopedLogger({ route: "auth.meta-ads.start" });

function buildSettingsRedirect({ provider, status, message, lang }) {
  const url = new URL("/app/settings", "http://localhost");
  url.searchParams.set("oauth", provider);
  url.searchParams.set("status", status);
  if (message) {
    url.searchParams.set("message", message);
  }
  if (lang) {
    url.searchParams.set("lang", lang);
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
  const baseUrl = getEnvVar("SHOPIFY_APP_URL");
  return new URL(pathname, baseUrl).toString();
}

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const lang = resolveLangFromRequest(request);
  const copy = OAUTH_COPY[lang] ?? OAUTH_COPY.en;
  const formData = await request.formData();
  const accountId = normalizeAccountId(formData.get("accountId"));
  const accountName = formData.get("accountName")?.toString().trim() || undefined;

  if (!accountId) {
    return buildSettingsRedirect({
      provider: "meta-ads",
      status: "error",
      message: copy.accountIdRequired,
      lang,
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
      lang,
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
      message: copy.startFailed,
      lang,
    });
  }
};

function resolveLangFromRequest(request) {
  const langParam = new URL(request.url).searchParams.get("lang");
  return langParam && langParam.toLowerCase() === "zh" ? "zh" : "en";
}

const OAUTH_COPY = {
  en: {
    accountIdRequired: "Please provide a Meta Ads account ID (act_123456789).",
    startFailed: "Could not start Meta authorization. Please check the app configuration.",
  },
  zh: {
    accountIdRequired: "请提供 Meta 广告账号 ID (act_123456789)。",
    startFailed: "无法启动 Meta 授权，请检查应用配置。",
  },
};

import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import {
  buildGoogleAdsAuthorizationUrl,
} from "../services/oauth/google-ads.server.js";
import { createSignedState } from "../utils/oauth-state.server.js";

function buildSettingsRedirect({ provider, status, message }) {
  const url = new URL("/app/settings", "http://localhost");
  url.searchParams.set("oauth", provider);
  url.searchParams.set("status", status);
  if (message) {
    url.searchParams.set("message", message);
  }
  const pathname = `${url.pathname}?${url.searchParams.toString()}`;
  return new Response(null, {
    status: 302,
    headers: { Location: pathname },
  });
}

function sanitizeAccountId(raw) {
  if (!raw) return null;
  const cleaned = raw.toString().replace(/[^0-9]/g, "");
  return cleaned || null;
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
  const accountId = sanitizeAccountId(formData.get("accountId"));
  const accountName = formData.get("accountName")?.toString().trim() || undefined;
  const loginCustomerId = sanitizeAccountId(formData.get("loginCustomerId"));

  if (!accountId) {
    return buildSettingsRedirect({
      provider: "google-ads",
      status: "error",
      message: "请提供 Google Ads Customer ID。",
    });
  }

  try {
    const state = createSignedState({
      provider: "GOOGLE_ADS",
      merchantId: store.merchantId,
      storeId: store.id,
      accountId,
      accountName: accountName ?? null,
      loginCustomerId: loginCustomerId ?? null,
      userEmail: session.email ?? null,
      redirectPath: "/app/settings",
    });

    const redirectUri = resolveAbsoluteUrl("/auth/google-ads/callback");
    const authorizationUrl = buildGoogleAdsAuthorizationUrl({
      state,
      redirectUri,
      loginCustomerId,
    });

    return new Response(null, {
      status: 302,
      headers: { Location: authorizationUrl },
    });
  } catch (error) {
    console.error("Failed to start Google Ads OAuth", error);
    return buildSettingsRedirect({
      provider: "google-ads",
      status: "error",
      message: "无法启动 Google OAuth，请检查配置。",
    });
  }
};

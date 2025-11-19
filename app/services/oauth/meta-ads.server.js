import { ExternalServiceError } from "../../errors/external-service-error.js";
import { fetchWithTimeout } from "../../utils/http.server.js";

const META_AUTH_URL = "https://www.facebook.com/v20.0/dialog/oauth";
const META_TOKEN_URL = "https://graph.facebook.com/v20.0/oauth/access_token";
export const META_ADS_SCOPE = "ads_read,ads_management";

function getMetaAppId() {
  const value = process.env.META_ADS_APP_ID;
  if (!value) {
    throw new Error("META_ADS_APP_ID is not configured");
  }
  return value;
}

function getMetaAppSecret() {
  const value = process.env.META_ADS_APP_SECRET;
  if (!value) {
    throw new Error("META_ADS_APP_SECRET is not configured");
  }
  return value;
}

export function buildMetaAdsAuthorizationUrl({ state, redirectUri }) {
  const clientId = getMetaAppId();
  if (!redirectUri) {
    throw new Error("Meta Ads OAuth redirectUri missing");
  }
  const url = new URL(META_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_ADS_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeMetaAdsCode({ code, redirectUri }) {
  const clientId = getMetaAppId();
  const clientSecret = getMetaAppSecret();
  if (!code) {
    throw new Error("Meta Ads authorization code missing");
  }
  if (!redirectUri) {
    throw new Error("Meta Ads redirectUri missing");
  }

  const response = await fetchWithTimeout("meta-ads-oauth", META_TOKEN_URL + `?` + new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  }).toString());

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || response.statusText;
    throw new ExternalServiceError("meta-ads-oauth", {
      status: response.status,
      message: `Meta token exchange failed: ${message}`,
    });
  }

  return extendMetaAccessToken(payload.access_token);
}

export async function extendMetaAccessToken(accessToken) {
  const clientId = getMetaAppId();
  const clientSecret = getMetaAppSecret();
  if (!accessToken) {
    throw new Error("Meta access token missing for extension");
  }

  const response = await fetchWithTimeout("meta-ads-oauth", META_TOKEN_URL + `?` + new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: clientId,
    client_secret: clientSecret,
    fb_exchange_token: accessToken,
  }).toString());

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || response.statusText;
    throw new ExternalServiceError("meta-ads-oauth", {
      status: response.status,
      message: `Meta access token extension failed: ${message}`,
    });
  }

  const expiresIn = Number(payload.expires_in ?? 0);
  const expiresAt = expiresIn
    ? new Date(Date.now() + Math.max(expiresIn - 300, 300) * 1000)
    : null;

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresAt,
    scope: META_ADS_SCOPE,
  };
}

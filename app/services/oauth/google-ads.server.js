const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

function getGoogleClientId() {
  const value = process.env.GOOGLE_ADS_CLIENT_ID;
  if (!value) {
    throw new Error("GOOGLE_ADS_CLIENT_ID is not configured");
  }
  return value;
}

function getGoogleClientSecret() {
  const value = process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!value) {
    throw new Error("GOOGLE_ADS_CLIENT_SECRET is not configured");
  }
  return value;
}

export function getGoogleDeveloperToken() {
  const value = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!value) {
    throw new Error("GOOGLE_ADS_DEVELOPER_TOKEN is not configured");
  }
  return value;
}

export function buildGoogleAdsAuthorizationUrl({ state, redirectUri, loginCustomerId }) {
  const clientId = getGoogleClientId();
  if (!redirectUri) {
    throw new Error("Google Ads OAuth redirectUri missing");
  }

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("scope", GOOGLE_ADS_SCOPE);
  url.searchParams.set("state", state);
  if (loginCustomerId) {
    url.searchParams.set("login_hint", loginCustomerId);
  }
  return url.toString();
}

export async function exchangeGoogleAdsCode({ code, redirectUri }) {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  if (!code) {
    throw new Error("Google Ads authorization code missing");
  }
  if (!redirectUri) {
    throw new Error("Google Ads redirectUri missing");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code,
    }).toString(),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error_description || payload?.error || response.statusText;
    throw new Error(`Google token exchange failed: ${message}`);
  }
  const expiresIn = Number(payload.expires_in ?? 0);
  const expiresAt = expiresIn
    ? new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000)
    : null;
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt,
    tokenType: payload.token_type,
    scope: payload.scope,
  };
}

export async function refreshGoogleAdsAccessToken(refreshToken) {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  if (!refreshToken) {
    throw new Error("Missing Google Ads refresh token");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error_description || payload?.error || response.statusText;
    throw new Error(`Google Ads token refresh failed: ${message}`);
  }
  const expiresIn = Number(payload.expires_in ?? 0);
  const expiresAt = expiresIn
    ? new Date(Date.now() + Math.max(expiresIn - 60, 60) * 1000)
    : null;

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expiresAt,
    scope: payload.scope,
    tokenType: payload.token_type,
  };
}

import { requireAccessToken } from "../credentials.server";

const GOOGLE_ADS_VERSION = "v16";

export async function fetchGoogleAdMetrics({
  accountId,
  secret = {},
  days = 7,
}) {
  if (!accountId) {
    throw new Error("Google Ads credential is missing a customer id.");
  }

  const accessToken = requireAccessToken(secret, "Google Ads");
  const developerToken = secret.developerToken;
  if (!developerToken) {
    throw new Error("Google Ads credential must include a developerToken.");
  }

  const effectiveDays = Math.min(Math.max(days, 1), 30);
  const duringClause = effectiveDays === 1 ? "TODAY" : `LAST_${effectiveDays}_DAYS`;
  const query = `
    SELECT
      customer.currency_code,
      segments.date,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group_ad.ad.id,
      ad_group_ad.ad.name,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions
    FROM ad_group_ad
    WHERE segments.date DURING ${duringClause}
  `;

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${accountId}/googleAds:search`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": developerToken,
    "Content-Type": "application/json",
  };
  if (secret.loginCustomerId) {
    headers["login-customer-id"] = secret.loginCustomerId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Google Ads API error (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  const rows = payload?.results ?? [];
  return rows.map((row) => {
    const metrics = row.metrics ?? {};
    const currency = row.customer?.currencyCode ?? secret.currency ?? "USD";
    return {
      accountId,
      campaignId: row.campaign?.id,
      campaignName: row.campaign?.name,
      adSetId: row.adGroup?.id,
      adSetName: row.adGroup?.name,
      adId: row.adGroupAd?.ad?.id,
      adName: row.adGroupAd?.ad?.name,
      date: new Date(row.segments?.date ?? new Date()),
      currency,
      spend: Number(metrics.costMicros ?? 0) / 1_000_000,
      impressions: Number(metrics.impressions ?? 0),
      clicks: Number(metrics.clicks ?? 0),
      conversions: Number(metrics.conversions ?? 0),
    };
  });
}

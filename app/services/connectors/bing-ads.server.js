import { requireAccessToken } from "../credentials.server";

const DEFAULT_BING_ENDPOINT =
  "https://api.ads.microsoft.com/v13/reports/adsPerformance";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildBingPayload({ customerId, start, end }) {
  return {
    customerId,
    reportName: "AdPerformance",
    timePeriod: {
      startDate: formatDate(start),
      endDate: formatDate(end),
    },
    columns: [
      "Date",
      "CampaignId",
      "CampaignName",
      "AdGroupId",
      "AdGroupName",
      "AdId",
      "AdName",
      "Spend",
      "Impressions",
      "Clicks",
      "Conversions",
    ],
  };
}

function normalizeBingRow(row, currency = "USD") {
  const dims = row.dimensions ?? {};
  const metrics = row.metrics ?? {};
  return {
    accountId: row.customerId ?? dims.customerId,
    campaignId: dims.campaignId ?? dims.campaign_id,
    campaignName: dims.campaignName ?? dims.campaign_name,
    adSetId: dims.adGroupId ?? dims.ad_group_id,
    adSetName: dims.adGroupName ?? dims.ad_group_name,
    adId: dims.adId ?? dims.ad_id,
    adName: dims.adName ?? dims.ad_name,
    date: new Date(row.date ?? row.timePeriod),
    currency,
    spend: Number(metrics.spend ?? 0),
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    conversions: Number(metrics.conversions ?? metrics.conversion ?? 0),
  };
}

export async function fetchBingAdMetrics({
  accountId,
  secret = {},
  days = 7,
}) {
  const customerId = accountId?.toString();
  if (!customerId) {
    throw new Error("Bing (Microsoft) Ads credential is missing a customer ID.");
  }
  const accessToken = requireAccessToken(secret, "Bing Ads");
  const developerToken = secret.developerToken;
  if (!developerToken) {
    throw new Error("Bing Ads credential must include a developerToken.");
  }

  const today = new Date();
  const since = new Date(today);
  since.setUTCDate(today.getUTCDate() - (Math.max(days, 1) - 1));

  const payload = buildBingPayload({ customerId, start: since, end: today });
  const endpoint = secret.endpoint ?? DEFAULT_BING_ENDPOINT;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Developer-Token": developerToken,
      "Customer-Id": customerId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Bing Ads API error (${response.status}): ${text.slice(0, 400)}`,
    );
  }

  const payloadData = await response.json();
  const rows = Array.isArray(payloadData?.data?.rows)
    ? payloadData.data.rows
    : Array.isArray(payloadData?.report?.rows)
      ? payloadData.report.rows
      : payloadData?.data ?? [];

  const currency =
    secret.currency ??
    payloadData?.data?.currency ??
    payloadData?.report?.currency ??
    "USD";

  return rows.map((row) => normalizeBingRow(row, currency));
}

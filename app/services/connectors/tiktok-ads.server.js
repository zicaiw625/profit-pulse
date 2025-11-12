import { requireAccessToken } from "../credentials.server";

const DEFAULT_TIKTOK_ENDPOINT =
  "https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildTikTokPayload({ advertiserId, start, end }) {
  return {
    advertiser_id: advertiserId,
    report_type: "BASIC",
    dimensions: [
      "campaign_id",
      "campaign_name",
      "adgroup_id",
      "adgroup_name",
      "ad_id",
      "ad_name",
    ],
    metrics: ["spend", "impressions", "click", "conversion"],
    page: 1,
    page_size: 5000,
    start_date: formatDate(start),
    end_date: formatDate(end),
  };
}

function normalizeTikTokRow(row, currency = "USD") {
  const dimensions = row.dimensions ?? {};
  const metrics = row.metrics ?? {};
  return {
    accountId: row.advertiser_id ?? dimensions.advertiser_id,
    campaignId: dimensions.campaign_id,
    campaignName: dimensions.campaign_name,
    adSetId: dimensions.adgroup_id,
    adSetName: dimensions.adgroup_name,
    adId: dimensions.ad_id,
    adName: dimensions.ad_name,
    date: new Date(row.date || row.stat_datetime || row.start_date),
    currency,
    spend: Number(metrics.spend ?? 0),
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.click ?? metrics.clicks ?? 0),
    conversions: Number(metrics.conversion ?? metrics.conversions ?? 0),
  };
}

export async function fetchTikTokAdMetrics({
  accountId,
  secret = {},
  days = 7,
}) {
  const advertiserId = accountId?.toString();
  if (!advertiserId) {
    throw new Error("TikTok Ads credential is missing an advertiser ID.");
  }
  const accessToken = requireAccessToken(secret, "TikTok Ads");
  const today = new Date();
  const since = new Date(today);
  since.setUTCDate(today.getUTCDate() - (Math.max(days, 1) - 1));

  const payload = buildTikTokPayload({
    advertiserId,
    start: since,
    end: today,
  });

  const endpoint = secret.endpoint ?? DEFAULT_TIKTOK_ENDPOINT;
  const url = new URL(endpoint);
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `TikTok Ads API error (${response.status}): ${text.slice(0, 200)}`,
    );
  }

  const payloadData = await response.json();
  const rows = Array.isArray(payloadData?.data?.list)
    ? payloadData.data.list
    : Array.isArray(payloadData?.data?.rows)
      ? payloadData.data.rows
      : payloadData?.data ?? [];

  const currency =
    secret.currency ??
    payloadData?.data?.currency ??
    payloadData?.data?.headers?.currency ??
    "USD";

  return rows.map((row) => normalizeTikTokRow(row, currency));
}

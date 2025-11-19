import { ExternalServiceError } from "../../errors/external-service-error.js";
import { fetchWithTimeout } from "../../utils/http.server.js";
import { requireAccessToken } from "../credentials.server.js";

const META_SERVICE = "meta-ads";

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeAccountId(accountId) {
  if (!accountId) return null;
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

export async function fetchMetaAdMetrics({
  accountId,
  secret = {},
  days = 7,
}) {
  const normalizedAccount = normalizeAccountId(accountId);
  if (!normalizedAccount) {
    throw new Error("Meta Ads credential is missing an account id.");
  }

  const accessToken = requireAccessToken(secret, "Meta Ads");
  const today = new Date();
  const since = new Date(today);
  since.setUTCDate(today.getUTCDate() - (Math.max(days, 1) - 1));

  const url = new URL(
    `https://graph.facebook.com/v20.0/${normalizedAccount}/insights`,
  );
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set(
    "time_range",
    JSON.stringify({ since: formatDate(since), until: formatDate(today) }),
  );
  url.searchParams.set(
    "fields",
    [
      "date_start",
      "campaign_id",
      "campaign_name",
      "adset_id",
      "adset_name",
      "ad_id",
      "ad_name",
      "spend",
      "impressions",
      "clicks",
      "actions",
      "action_values",
      "account_currency",
    ].join(","),
  );

  const response = await fetchWithTimeout(META_SERVICE, url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ExternalServiceError(META_SERVICE, {
      status: response.status,
      message: "Meta Ads API request failed",
      detail: text.slice(0, 200),
    });
  }

  const payload = await response.json();
  const rows = payload?.data ?? [];
  return rows.map((row) => ({
    accountId: normalizedAccount,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    adSetId: row.adset_id,
    adSetName: row.adset_name,
    adId: row.ad_id,
    adName: row.ad_name,
    date: new Date(row.date_start),
    currency: row.account_currency ?? secret.currency ?? "USD",
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    conversions: extractPurchaseConversions(row.actions),
  }));
}

function extractPurchaseConversions(actions = []) {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter((action) =>
      ["purchase", "offsite_conversion.purchase"].includes(
        action.action_type,
      ),
    )
    .reduce((sum, action) => sum + Number(action.value ?? 0), 0);
}

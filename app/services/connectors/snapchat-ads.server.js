function ensureString(value) {
  return value ? value.toString() : "";
}

export async function fetchSnapchatAdMetrics({ accountId, secret = {}, days = 7 }) {
  const accessToken = secret.accessToken;
  if (!accessToken || !accountId) {
    throw new Error("Snapchat Ads account id and access token are required.");
  }

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - (Math.max(days, 1) - 1));

  const url = new URL(`https://adsapi.snapchat.com/v1/adaccounts/${accountId}/campaigns`);
  url.searchParams.set("time_range.start", startDate.toISOString().slice(0, 10));
  url.searchParams.set("time_range.end", endDate.toISOString().slice(0, 10));
  url.searchParams.set("fields", "campaign_name,spend,impressions,swipes,ad_group_name,ads");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Snapchat Ads API error (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const rows = payload?.campaigns ?? payload?.data ?? [];
  return rows.map((row) => {
    const metrics = row?.metrics ?? row;
    return {
      accountId,
      campaignId: ensureString(row.campaign_id ?? row.id),
      campaignName: row.campaign_name ?? row.name,
      adSetId: ensureString(row.ad_group_id ?? row.ad_group?.id),
      adSetName: row.ad_group_name ?? row.ad_group?.name,
      adId: ensureString(row.ad_id ?? row.ads?.[0]?.id),
      adName: row.ads?.[0]?.name ?? row.name,
      date: new Date(metrics?.date ?? row.date ?? Date.now()),
      currency: secret.currency ?? "USD",
      spend: Number(metrics?.spend ?? row.spend ?? 0),
      impressions: Number(metrics?.impressions ?? 0),
      clicks: Number(metrics?.swipes ?? metrics?.clicks ?? 0),
      conversions: Number(metrics?.purchases ?? 0),
    };
  });
}

function formatDate(date) {
  return new Date(date ?? Date.now()).toISOString().slice(0, 10);
}

export async function fetchAmazonAdMetrics({ accountId, secret = {}, days = 7 }) {
  const accessToken = secret.accessToken;
  if (!accessToken) {
    throw new Error("Amazon Ads access token is required to fetch metrics.");
  }

  const profileId = secret.profileId ?? accountId;
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - (Math.max(days, 1) - 1));

  const url = new URL("https://advertising-api.amazon.com/v2/sp/campaigns");
  url.searchParams.set("startAt", startDate.toISOString());
  url.searchParams.set("endAt", endDate.toISOString());
  url.searchParams.set("metrics", "spend,impressions,clicks,attributedPurchases");
  url.searchParams.set("campaignType", "sponsoredProducts");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Amazon-Advertising-API-Scope": profileId,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Amazon Ads API error (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = await response.json();
  const rows = payload?.campaigns ?? payload?.payload ?? [];
  return rows.map((row) => {
    const dateValue = row.startAt ?? row.reportDate ?? formatDate(row.date);
    return {
      accountId: profileId,
      campaignId: row.campaignId ?? row.id,
      campaignName: row.name,
      adSetId: row.adGroupId,
      adSetName: row.adGroupName,
      adId: row.adId,
      adName: row.adName,
      date: new Date(dateValue),
      currency: row.currencyCode ?? secret.currency ?? "USD",
      spend: Number(row.spend ?? row.cost ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      conversions: Number(row.attributedPurchases ?? 0),
    };
  });
}

import { getAccountingDetailRows } from "./accounting.server";

const PROVIDER_ENDPOINTS = {
  QUICKBOOKS: process.env.QUICKBOOKS_SYNC_URL,
  XERO: process.env.XERO_SYNC_URL,
};

export async function syncAccountingProvider({ store, provider, rangeDays = 30 }) {
  if (!store?.id) {
    throw new Error("Store is required to sync accounting data");
  }
  const normalizedProvider = (provider || "").toUpperCase();
  const endpoint = PROVIDER_ENDPOINTS[normalizedProvider];
  if (!endpoint) {
    throw new Error(
      normalizedProvider === "QUICKBOOKS"
        ? "QUICKBOOKS_SYNC_URL is not configured."
        : normalizedProvider === "XERO"
          ? "XERO_SYNC_URL is not configured."
          : `Unsupported accounting provider: ${provider}`,
    );
  }

  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd);
  rangeStart.setUTCDate(rangeEnd.getUTCDate() - (Math.max(rangeDays, 1) - 1));

  const detail = await getAccountingDetailRows({
    storeId: store.id,
    start: rangeStart,
    end: rangeEnd,
  });

  const payload = {
    store: store.shopDomain,
    currency: detail.currency,
    timezone: detail.timezone,
    range: detail.range,
    rows: detail.rows,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to sync ${normalizedProvider} data (${response.status}): ${await response.text()}`,
    );
  }

  return { count: detail.rows.length };
}

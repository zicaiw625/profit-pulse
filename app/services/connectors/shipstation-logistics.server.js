// TODO: enable when logistics integrations are ready for public launch.
const DEFAULT_BASE_URL = "https://ssapi.shipstation.com";

function normalizeUrl(baseUrl) {
  if (!baseUrl) return DEFAULT_BASE_URL;
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function mapRate(record, fallbackCurrency) {
  if (!record) return null;
  const destination = record.destination || {};
  const minWeight =
    Number.parseFloat(record.minWeight ?? record.weight_min ?? 0) || 0;
  const maxWeightRaw = record.maxWeight ?? record.weight_max ?? record.weightLimit;
  const maxWeight =
    maxWeightRaw === null || maxWeightRaw === undefined
      ? null
      : Number.parseFloat(maxWeightRaw);
  return {
    provider: record.provider ?? record.carrier ?? "ShipStation",
    country: record.country ?? destination.country ?? null,
    region: record.region ?? destination.state ?? null,
    weightMin: minWeight,
    weightMax: Number.isFinite(maxWeight) ? maxWeight : null,
    flatFee:
      Number.parseFloat(record.flatFee ?? record.baseRate ?? record.flat_rate) || 0,
    perKg:
      Number.parseFloat(
        record.perKg ?? record.surchargePerKg ?? record.variable_rate,
      ) || 0,
    currency: record.currency ?? fallbackCurrency ?? "USD",
    effectiveFrom: record.validFrom ?? record.effective_from ?? null,
    effectiveTo: record.validTo ?? record.effective_to ?? null,
  };
}

export async function fetchShipStationLogisticsRates({
  secret = {},
  currency = "USD",
  fetchImpl = fetch,
}) {
  if (!secret) {
    throw new Error("Missing ShipStation credential payload");
  }

  if (Array.isArray(secret.rateTable) && secret.rateTable.length) {
    return secret.rateTable
      .map((rate) => mapRate(rate, currency))
      .filter(Boolean);
  }

  const apiKey = secret.apiKey ?? secret.accessKeyId;
  const apiSecret = secret.apiSecret ?? secret.accessKeySecret;
  if (!apiKey || !apiSecret) {
    throw new Error(
      "ShipStation credential must include apiKey/apiSecret for API sync.",
    );
  }

  const baseUrl = normalizeUrl(secret.baseUrl);
  const response = await fetchImpl(`${baseUrl}/logistics/ratecards`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString(
        "base64",
      )}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `ShipStation rate fetch failed (${response.status}): ${body?.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  const records = Array.isArray(payload?.rateCards)
    ? payload.rateCards
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return records.map((record) => mapRate(record, currency)).filter(Boolean);
}

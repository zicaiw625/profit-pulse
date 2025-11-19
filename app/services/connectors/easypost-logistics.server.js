// TODO: enable when logistics integrations are ready for public launch.
const DEFAULT_BASE_URL = "https://api.easypost.com";

function normalizeUrl(baseUrl) {
  if (!baseUrl) return DEFAULT_BASE_URL;
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function mapRate(record, fallbackCurrency) {
  if (!record) return null;
  const destination = record.destination || {};
  const minWeight =
    Number.parseFloat(record.min_weight_kg ?? record.weight_min ?? 0) || 0;
  const maxWeightRaw =
    record.max_weight_kg ?? record.weight_max ?? record.weight_limit_kg;
  const maxWeight =
    maxWeightRaw === null || maxWeightRaw === undefined
      ? null
      : Number.parseFloat(maxWeightRaw);
  return {
    provider: record.provider ?? "EasyPost",
    country: record.country ?? destination.country ?? null,
    region: record.region ?? destination.state ?? null,
    weightMin: minWeight,
    weightMax: Number.isFinite(maxWeight) ? maxWeight : null,
    flatFee:
      Number.parseFloat(record.flat_fee ?? record.base_charge ?? record.flatRate) || 0,
    perKg:
      Number.parseFloat(
        record.per_kg ?? record.variable_charge ?? record.variableRate,
      ) || 0,
    currency: record.currency ?? fallbackCurrency ?? "USD",
    effectiveFrom:
      record.effective_from ?? record.valid_from ?? record.effectiveFrom ?? null,
    effectiveTo:
      record.effective_to ?? record.valid_to ?? record.effectiveTo ?? null,
  };
}

export async function fetchEasyPostLogisticsRates({
  secret = {},
  currency = "USD",
  fetchImpl = fetch,
}) {
  if (!secret) {
    throw new Error("Missing EasyPost credential payload");
  }

  if (Array.isArray(secret.rateTable) && secret.rateTable.length) {
    return secret.rateTable
      .map((rate) => mapRate(rate, currency))
      .filter(Boolean);
  }

  const apiKey = secret.apiKey ?? secret.accessToken;
  if (!apiKey) {
    throw new Error(
      "EasyPost credential must include apiKey or accessToken for API sync.",
    );
  }

  const baseUrl = normalizeUrl(secret.baseUrl);
  const carrierAccounts = Array.isArray(secret.carrierAccounts)
    ? secret.carrierAccounts.filter(Boolean)
    : [];
  const query = carrierAccounts.length
    ? `?carrier_accounts=${carrierAccounts.join(",")}`
    : "";
  const response = await fetchImpl(
    `${baseUrl}/v2/logistics/rates${query}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `EasyPost rate fetch failed (${response.status}): ${body?.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  const records = Array.isArray(payload?.rates)
    ? payload.rates
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return records.map((record) => mapRate(record, currency)).filter(Boolean);
}

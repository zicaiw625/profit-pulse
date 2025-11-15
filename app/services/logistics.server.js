import prisma from "../db.server.js";
import { getExchangeRate } from "./exchange-rates.server.js";

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function listLogisticsRules(storeId) {
  if (!storeId) return [];
  return prisma.logisticsRule.findMany({
    where: { storeId },
    orderBy: { effectiveFrom: "desc" },
  });
}

export async function importLogisticsRatesFromCsv({
  storeId,
  csv,
  defaultCurrency = "USD",
}) {
  if (!storeId) {
    throw new Error("Store is required to import logistics rates");
  }
  if (!csv) {
    throw new Error("CSV content is required to import logistics rules");
  }

  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("CSV file is empty");
  }

  const headers = lines[0]
    .split(",")
    .map((header) => header.trim().toLowerCase());

  const providerIdx = headers.indexOf("provider");
  const countryIdx = headers.indexOf("country");
  const regionIdx = headers.indexOf("region");
  const weightMinIdx = headers.indexOf("weight_min");
  const weightMaxIdx = headers.indexOf("weight_max");
  const flatFeeIdx = headers.indexOf("flat_fee");
  const perKgIdx = headers.indexOf("per_kg");
  const currencyIdx = headers.indexOf("currency");
  const fromIdx = headers.indexOf("effective_from");
  const toIdx = headers.indexOf("effective_to");

  if (countryIdx === -1 && regionIdx === -1) {
    throw new Error("CSV must include at least a country or region column");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    const country = countryIdx !== -1 ? (parts[countryIdx] ?? "").trim() : null;
    const region = regionIdx !== -1 ? (parts[regionIdx] ?? "").trim() : null;
    if (!country && !region) {
      continue;
    }
    const provider = providerIdx !== -1 ? parts[providerIdx]?.trim() : null;
    const weightMin = weightMinIdx !== -1 ? toNumber(parts[weightMinIdx]) : 0;
    const weightMax = weightMaxIdx !== -1 ? toNumber(parts[weightMaxIdx]) : null;
    const flatFee = flatFeeIdx !== -1 ? toNumber(parts[flatFeeIdx]) : 0;
    const perKg = perKgIdx !== -1 ? toNumber(parts[perKgIdx]) : 0;
    const currency = currencyIdx !== -1
      ? parts[currencyIdx]?.trim() || defaultCurrency
      : defaultCurrency;
    const effectiveFrom = parseDate(
      fromIdx !== -1 ? parts[fromIdx]?.trim() : null,
    );
    const effectiveTo = parseDate(
      toIdx !== -1 ? parts[toIdx]?.trim() : null,
    );

    rows.push({
      storeId,
      provider: provider || null,
      country: country || null,
      region: region || null,
      weightMin: weightMin || 0,
      weightMax: weightMax || null,
      flatFee: flatFee || 0,
      perKg: perKg || 0,
      currency: currency || defaultCurrency,
      effectiveFrom,
      effectiveTo,
    });
  }

  if (!rows.length) {
    throw new Error("No valid rows detected in CSV");
  }

  await prisma.logisticsRule.createMany({
    data: rows,
  });

  return rows.length;
}

export async function getLogisticsCost({
  storeId,
  country,
  region,
  weightKg = 0,
  provider,
  date = new Date(),
  currency = "USD",
}) {
  if (!storeId || weightKg <= 0) {
    return 0;
  }

  const rules = await prisma.logisticsRule.findMany({
    where: { storeId },
  });

  if (!rules.length) {
    return 0;
  }

  const normalizedWeight = Number(weightKg);
  const normalizedCountry = country?.toUpperCase() ?? null;
  const normalizedRegion = region?.toUpperCase() ?? null;

  const candidates = rules
    .map((rule) => {
      const minWeight =
        rule.weightMin !== null && rule.weightMin !== undefined
          ? Number(rule.weightMin)
          : 0;
      const maxWeight =
        rule.weightMax !== null && rule.weightMax !== undefined
          ? Number(rule.weightMax)
          : Number.POSITIVE_INFINITY;
      const providerMatch =
        !rule.provider || !provider || rule.provider === provider;
      const countryMatch =
        !rule.country ||
        (normalizedCountry && rule.country.toUpperCase() === normalizedCountry);
      const regionMatch =
        !rule.region ||
        (normalizedRegion && rule.region.toUpperCase() === normalizedRegion);
      const inWeightRange =
        normalizedWeight >= minWeight && normalizedWeight <= maxWeight;
      const effectiveFromMatch =
        !rule.effectiveFrom || rule.effectiveFrom <= date;
      const effectiveToMatch =
        !rule.effectiveTo || rule.effectiveTo >= date;

      if (
        providerMatch &&
        countryMatch &&
        regionMatch &&
        inWeightRange &&
        effectiveFromMatch &&
        effectiveToMatch
      ) {
        const specificity =
          (rule.provider ? 1 : 0) +
          (rule.region ? 2 : rule.country ? 1 : 0);
        return {
          rule,
          score: specificity,
        };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const match = candidates[0]?.rule;
  if (!match) {
    return 0;
  }

  const flatFee = Number(match.flatFee ?? 0);
  const perKg = Number(match.perKg ?? 0);
  const rawCost = flatFee + perKg * normalizedWeight;
  const baseCurrency = match.currency || "USD";
  const conversionRate = await getExchangeRate({
    base: baseCurrency,
    quote: currency,
    asOf: date,
  });

  return Number(rawCost * conversionRate);
}

export async function replaceLogisticsRulesFromRates({
  storeId,
  provider,
  rates = [],
  defaultCurrency = "USD",
}) {
  if (!storeId) {
    throw new Error("storeId is required to replace logistics rules");
  }

  const sanitized = rates
    .map((rate) => ({
      storeId,
      provider: provider ?? rate.provider ?? null,
      country: rate.country ? rate.country.toUpperCase() : null,
      region: rate.region ? rate.region.toUpperCase() : null,
      weightMin: toNumber(rate.weightMin ?? rate.minWeight ?? 0),
      weightMax:
        rate.weightMax === null || rate.weightMax === undefined
          ? null
          : toNumber(rate.weightMax),
      flatFee: toNumber(rate.flatFee ?? rate.baseRate ?? 0),
      perKg: toNumber(rate.perKg ?? rate.variableRate ?? 0),
      currency: rate.currency ?? defaultCurrency,
      effectiveFrom: parseDate(rate.effectiveFrom),
      effectiveTo: parseDate(rate.effectiveTo),
    }))
    .filter((entry) => entry.flatFee > 0 || entry.perKg > 0);

  if (!sanitized.length) {
    return 0;
  }

  await prisma.$transaction([
    prisma.logisticsRule.deleteMany({
      where: { storeId, provider: provider ?? null },
    }),
    prisma.logisticsRule.createMany({ data: sanitized }),
  ]);

  return sanitized.length;
}

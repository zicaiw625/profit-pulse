import prisma from "../db.server";
import { fetchLatestRates } from "./external/fx-provider.server";

export async function refreshExchangeRates(base = "USD") {
  const data = await fetchLatestRates(base);
  if (!data || !data.rates) {
    throw new Error("Failed to fetch exchange rates");
  }
  const entries = Object.entries(data.rates).map(([quote, rate]) => ({
    base,
    quote,
    rate,
    asOf: new Date(data.asOf ?? Date.now()),
    source: data.source ?? "API",
  }));
  await Promise.all(
    entries.map((entry) =>
      prisma.exchangeRate.upsert({
        where: {
          base_quote_asOf: {
            base: entry.base,
            quote: entry.quote,
            asOf: entry.asOf,
          },
        },
        update: { rate: entry.rate, source: entry.source },
        create: entry,
      }),
    ),
  );
  return {
    count: entries.length,
    asOf: data.asOf ?? new Date(),
  };
}

export async function setCustomExchangeRate({ base, quote, rate }) {
  const normalizedBase = (base ?? "").toString().trim().toUpperCase();
  const normalizedQuote = (quote ?? "").toString().trim().toUpperCase();
  const numericRate = Number(rate);
  if (!normalizedBase || !normalizedQuote) {
    throw new Error("Base and quote currencies are required.");
  }
  if (normalizedBase === normalizedQuote) {
    throw new Error("Base and quote currencies must be different.");
  }
  if (!Number.isFinite(numericRate) || numericRate <= 0) {
    throw new Error("Exchange rate must be a positive number.");
  }
  const asOf = new Date();
  const record = await prisma.exchangeRate.create({
    data: {
      base: normalizedBase,
      quote: normalizedQuote,
      rate: numericRate,
      asOf,
      source: "Manual",
    },
  });
  return record;
}

export async function getExchangeRate({ base, quote, asOf = new Date() }) {
  if (!base || !quote || base === quote) {
    return 1;
  }
  const rate = await prisma.exchangeRate.findFirst({
    where: {
      base,
      quote,
      asOf: { lte: asOf },
    },
    orderBy: { asOf: "desc" },
  });
  if (rate) {
    return Number(rate.rate) || 1;
  }
  return 1;
}

export async function getExchangeRateSummary(base = "USD") {
  const latest = await prisma.exchangeRate.findFirst({
    where: { base },
    orderBy: { asOf: "desc" },
  });
  return latest
    ? {
        base,
        asOf: latest.asOf,
        quote: latest.quote,
      }
    : null;
}

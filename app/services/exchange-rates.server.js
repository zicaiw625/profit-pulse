import prisma from "../db.server";
import { fetchLatestRates } from "./external/fx-provider.server";

export async function refreshExchangeRates(base = "USD") {
  const data = await fetchLatestRates(base);
  if (!data || !data.rates) {
    throw new Error("Failed to fetch exchange rates");
  }
  const entries = Object.entries(data.rates).map(([quote, rate]) => ({ base, quote, rate, asOf: new Date(data.asOf ?? Date.now()), source: data.source ?? "API" }));
  await Promise.all(
    entries.map((entry) =>
      prisma.exchangeRate.upsert({
        where: { base_quote_asOf: { base: entry.base, quote: entry.quote, asOf: entry.asOf } },
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

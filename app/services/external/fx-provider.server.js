export async function fetchLatestRates(base = "USD") {
  // Placeholder: integrate with real FX provider (e.g., ECB, Fixer.io).
  const now = new Date();
  return {
    base,
    asOf: now,
    source: "Mock",
    rates: {
      USD: 1,
      EUR: 0.92,
      CAD: 1.37,
      GBP: 0.8,
    },
  };
}

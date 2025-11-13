const DEFAULT_STRIPE_API_BASE =
  process.env.STRIPE_API_BASE_URL || "https://api.stripe.com/v1";

function getStripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY must be configured to sync Stripe payouts.");
  }
  return key;
}

export async function fetchStripePayouts({ limit = 100, days = 7 }) {
  const secretKey = getStripeSecretKey();
  const since = Math.floor(
    (Date.now() - Math.max(days, 1) * 24 * 60 * 60 * 1000) / 1000,
  );
  const url = new URL("/balance_transactions", DEFAULT_STRIPE_API_BASE);
  url.searchParams.set("limit", String(Math.min(limit, 100)));
  url.searchParams.set("available_on[gte]", String(since));
  url.searchParams.set("type", "payout");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Stripe API error (${response.status}): ${await response.text()}`,
    );
  }
  const payload = await response.json();
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.map((entry) => {
    const currency = (entry.currency || "usd").toUpperCase();
    const grossAmount = Number(entry.amount ?? 0) / 100;
    const fee = Number(entry.fee ?? 0) / 100;
    return {
      payoutId: entry.id,
      status: entry.status ?? "paid",
      payoutDate: new Date((entry.available_on ?? entry.created ?? Date.now()) * 1000),
      currency,
      grossAmount,
      feeTotal: fee,
      netAmount: grossAmount - fee,
      transactions: entry,
    };
  });
}

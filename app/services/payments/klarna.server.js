import { Buffer } from "node:buffer";

const DEFAULT_KLARNA_API_BASE =
  process.env.KLARNA_API_BASE_URL || "https://api-na.klarna.com";

function getKlarnaCredentials() {
  const username = process.env.KLARNA_USERNAME;
  const password = process.env.KLARNA_PASSWORD;
  if (!username || !password) {
    throw new Error("KLARNA_USERNAME and KLARNA_PASSWORD must be configured to sync Klarna payouts.");
  }
  return { username, password };
}

export async function fetchKlarnaPayouts({ days = 7 } = {}) {
  const { username, password } = getKlarnaCredentials();
  const now = new Date();
  const since = new Date(now);
  since.setUTCDate(now.getUTCDate() - (Math.max(days, 1) - 1));

  const url = new URL("/settlements/v1/transactions", DEFAULT_KLARNA_API_BASE);
  url.searchParams.set("from", since.toISOString());
  url.searchParams.set("to", now.toISOString());

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Klarna API error (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  const rows = Array.isArray(payload?.transactions)
    ? payload.transactions
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

  return rows.map((row, index) => {
    const payoutId = row.id ?? row.transaction_id ?? `klarna-${row.settlement_id ?? index}`;
    const grossAmount = Number(row.amount ?? row.gross_amount ?? 0);
    const feeAmount = Number(row.fee_amount ?? row.fees ?? 0);
    const netAmount = Number(row.net_amount ?? grossAmount - feeAmount);
    return {
      payoutId,
      status: row.status ?? "PAID",
      payoutDate: row.payout_date ? new Date(row.payout_date) : new Date(row.created_at ?? Date.now()),
      currency: (row.currency ?? "USD").toUpperCase(),
      grossAmount,
      feeTotal: feeAmount,
      netAmount,
      transactions: row,
    };
  });
}

import pkg from "@prisma/client";
import prisma from "../../db.server";

const { CredentialProvider } = pkg;

const DEFAULT_PROVIDER = CredentialProvider.PAYPAL;

export async function importPaymentPayoutCsv({
  storeId,
  provider = DEFAULT_PROVIDER,
  csv,
}) {
  if (!storeId) {
    throw new Error("storeId is required for payment import");
  }
  if (!csv) {
    throw new Error("CSV 内容为空");
  }

  const providerKey = typeof provider === "string" ? provider : String(provider);
  if (!CredentialProvider[providerKey]) {
    throw new Error(`Unsupported payout provider: ${providerKey}`);
  }

  const rows = parseCsv(csv);
  if (!rows.length) {
    throw new Error("未检测到有效的结算记录");
  }

  await Promise.all(
    rows.map((row) =>
      prisma.paymentPayout.upsert({
        where: {
          storeId_payoutId: {
            storeId,
            payoutId: row.payoutId,
          },
        },
        create: {
          storeId,
          provider: providerKey,
          payoutId: row.payoutId,
          payoutDate: row.payoutDate,
          currency: row.currency,
          grossAmount: row.grossAmount,
          feeTotal: row.feeTotal,
          netAmount: row.netAmount,
          status: row.status,
          transactions: row.raw,
        },
        update: {
          payoutDate: row.payoutDate,
          currency: row.currency,
          grossAmount: row.grossAmount,
          feeTotal: row.feeTotal,
          netAmount: row.netAmount,
          status: row.status,
          transactions: row.raw,
        },
      }),
    ),
  );

  return rows.length;
}

export async function importPaypalPayoutCsv({ storeId, csv }) {
  return importPaymentPayoutCsv({
    storeId,
    provider: CredentialProvider.PAYPAL,
    csv,
  });
}

function parseCsv(csv) {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idIdx = headers.findIndex((h) =>
    ["payout id", "transaction id", "id"].includes(h),
  );
  const dateIdx = headers.findIndex((h) => h.includes("date"));
  const currencyIdx = headers.findIndex((h) => h.includes("currency"));
  const grossIdx = headers.findIndex((h) => h.includes("gross"));
  const feeIdx = headers.findIndex((h) => h.includes("fee"));
  const netIdx = headers.findIndex((h) => h.includes("net"));
  const statusIdx = headers.findIndex((h) => h.includes("status"));

  if (idIdx === -1 || dateIdx === -1 || netIdx === -1) {
    throw new Error("CSV 必须包含 payout id/date/net amount 等列");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",");
    const payoutId = cols[idIdx]?.trim();
    const payoutDate = parseDate(cols[dateIdx]);
    if (!payoutId || !payoutDate) continue;
    const currency = currencyIdx !== -1 ? cols[currencyIdx]?.trim() || "USD" : "USD";
    const grossAmount = parseNumber(cols[grossIdx]);
    const feeTotal = parseNumber(cols[feeIdx]);
    const netAmount = parseNumber(cols[netIdx]);
    rows.push({
      payoutId,
      payoutDate,
      currency,
      grossAmount,
      feeTotal,
      netAmount,
      status: statusIdx !== -1 ? cols[statusIdx]?.trim() || "PAID" : "PAID",
      raw: cols,
    });
  }
  return rows;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumber(value) {
  if (!value && value !== 0) return 0;
  const num = typeof value === "string"
    ? Number(value.replace(/[$,]/g, ""))
    : Number(value);
  return Number.isFinite(num) ? num : 0;
}

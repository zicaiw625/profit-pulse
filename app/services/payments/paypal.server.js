import { ExternalServiceError } from "../../errors/external-service-error.js";
import { fetchWithTimeout } from "../../utils/http.server.js";

const DEFAULT_PAYPAL_API_BASE =
  process.env.PAYPAL_API_BASE_URL || "https://api-m.paypal.com";

async function getPaypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be configured.");
  }
  const tokenUrl = new URL("/v1/oauth2/token", DEFAULT_PAYPAL_API_BASE);
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetchWithTimeout("paypal", tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ExternalServiceError("paypal", {
      status: response.status,
      message: "PayPal auth failed",
      detail: detail.slice(0, 200),
    });
  }
  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error("PayPal auth response missing access_token");
  }
  return payload.access_token;
}

export async function fetchPaypalPayouts({
  startDate,
  endDate,
  transactionType = "PAYOUT",
}) {
  const token = await getPaypalAccessToken();
  const url = new URL("/v1/reporting/transactions", DEFAULT_PAYPAL_API_BASE);
  const start = (startDate ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 7))
    .toISOString()
    .slice(0, 19)
    .concat("Z");
  const end = (endDate ?? new Date()).toISOString().slice(0, 19).concat("Z");
  url.searchParams.set("start_date", start);
  url.searchParams.set("end_date", end);
  url.searchParams.set("transaction_type", transactionType);
  const response = await fetchWithTimeout("paypal", url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ExternalServiceError("paypal", {
      status: response.status,
      message: "PayPal reporting API failed",
      detail: detail.slice(0, 200),
    });
  }
  const payload = await response.json();
  const details = payload?.transaction_details ?? [];
  return details.map((detail) => {
    const txn = detail?.transaction_info ?? {};
    const payer = detail?.payer_info ?? {};
    const cart = detail?.cart_info ?? {};
    const payoutId = txn.transaction_id ?? txn.transaction_event_code;
    const currency = txn.transaction_currency ?? "USD";
    const grossAmount = Number(txn.gross_amount?.value ?? 0);
    const feeAmount = Number(txn.fee_amount?.value ?? 0);
    const netAmount =
      Number(txn.net_amount?.value ?? grossAmount - feeAmount);
    return {
      payoutId: payoutId || `paypal-${Date.now()}`,
      status: txn.transaction_status ?? "COMPLETED",
      payoutDate: new Date(txn.transaction_initiation_date ?? Date.now()),
      currency,
      grossAmount,
      feeTotal: feeAmount,
      netAmount,
      metadata: {
        payerEmail: payer?.email_address,
        cartId: cart?.cart_id,
      },
      raw: detail,
    };
  });
}

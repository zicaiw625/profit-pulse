import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { listRefundRecords } from "../services/refunds.server";
import { logAuditEvent } from "../services/audit.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const refunds = await listRefundRecords({ storeId: store.id, rangeDays: 60 });

  const headers = [
    "Refund ID",
    "Order ID",
    "Date",
    "Amount",
    "Currency",
    "Reason",
  ];
  const rows = refunds.map((refund) => [
    refund.shopifyRefundId,
    refund.orderShopifyId,
    refund.processedAt.toISOString(),
    Number(refund.amount ?? 0).toFixed(2),
    refund.currency,
    refund.reason ?? "",
  ]);

  const body = [headers, ...rows]
    .map((row) => row.map(csvSafe).join(","))
    .join("\n");

  await logAuditEvent({
    merchantId: store.merchantId,
    userEmail: session.email,
    action: "export_refunds_csv",
    details: `Downloaded refund export for ${store.shopDomain}`,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=refunds.csv",
      "Cache-Control": "no-store",
    },
  });
};

function csvSafe(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if ([",", "\n", '"'].some((char) => stringValue.includes(char))) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

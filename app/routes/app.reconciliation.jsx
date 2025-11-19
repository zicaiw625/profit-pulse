import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import {
  getReconciliationSnapshot,
  runReconciliationChecks,
} from "../services/reconciliation.server";
import { formatCurrency } from "../utils/formatting";
import { RECONCILIATION_THRESHOLDS } from "../config/reconciliationThresholds.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  await runReconciliationChecks({ storeId: store.id });
  const snapshot = await getReconciliationSnapshot({
    storeId: store.id,
  });
  return {
    snapshot,
    rules: RECONCILIATION_THRESHOLDS,
    currency: store.currency ?? "USD",
  };
};

export default function ReconciliationPage() {
  const { snapshot, rules, currency } = useLoaderData();
  const paymentPercent = (rules.payment.percentDelta * 100).toFixed(1);
  const paymentAmount = formatCurrency(rules.payment.amountDelta, currency);
  const adsMultiple = rules.ads.conversionMultiple.toFixed(1);
  const spendThreshold = formatCurrency(rules.ads.minSpendWithoutConversions, currency);

  return (
    <s-page heading="Reconciliation workspace">
      <s-section heading="Summary">
        <s-stack direction="inline" gap="base" wrap>
          {snapshot.summary.map((item) => (
            <s-card key={item.title} padding="base">
              <s-heading>{item.title}</s-heading>
              <s-text variation="subdued">
                {item.issues} open issues · Δ {formatCurrency(item.amountDelta)}
              </s-text>
              <s-badge tone={item.status === "attention" ? "critical" : "warning"}>
                {item.status}
              </s-badge>
            </s-card>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Rule of thumb">
        <s-card padding="base">
          <s-text variation="subdued">
            当某天 Shopify 与支付渠道营收差异超过 {paymentPercent}% 或 {paymentAmount} 时，我们会标记为「支付异常」；
            当 Meta 转化数高于 Shopify 订单 {adsMultiple} 倍，或花费超过 {spendThreshold} 但 0 转化时，会标记为「广告异常」。
          </s-text>
        </s-card>
      </s-section>

      <s-section heading="Open issues">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">ID</th>
                <th align="left">Type</th>
                <th align="left">Channel</th>
                <th align="left">Order</th>
                <th align="left">Details</th>
                <th align="left">Detected</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.issues.map((issue) => (
                <tr key={issue.id}>
                  <td>{issue.id}</td>
                  <td>{issue.type}</td>
                  <td>{issue.channel}</td>
                  <td>{issue.orderNumber || "—"}</td>
                  <td>{issue.description}</td>
                  <td>{new Date(issue.detectedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section slot="aside" heading="Upcoming automation">
        <s-unordered-list>
          <s-list-item>Auto-close resolved payout diffs</s-list-item>
          <s-list-item>Email digest of large discrepancies</s-list-item>
          <s-list-item>Sync adjustments to accounting export</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

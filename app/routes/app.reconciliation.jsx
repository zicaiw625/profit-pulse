import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import {
  getReconciliationSnapshot,
  runReconciliationChecks,
} from "../services/reconciliation.server";
import { formatCurrency } from "../utils/formatting";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  await runReconciliationChecks({ storeId: store.id });
  const snapshot = await getReconciliationSnapshot({
    storeId: store.id,
  });
  return { snapshot };
};

export default function ReconciliationPage() {
  const { snapshot } = useLoaderData();

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

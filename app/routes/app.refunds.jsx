/* eslint-disable react/prop-types */
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getRefundAnalytics } from "../services/refunds.server";
import { formatCurrency, formatPercent } from "../utils/formatting";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop);
  const analytics = await getRefundAnalytics({ storeId: store.id, rangeDays: 30 });
  return { analytics };
};

export default function RefundsPage() {
  const { analytics } = useLoaderData();
  const { summary, timeseries, products, reasons, currency } = analytics;

  return (
    <s-page heading="Refund & returns analysis" subtitle="Last 30 days">
      <s-section heading="Key metrics">
        <s-stack direction="inline" gap="base" wrap>
          <SummaryCard label="Refund amount" value={summary.refundAmount} currency={currency} />
          <SummaryCard label="Refund rate" value={summary.refundRate} variant="percentage" />
          <SummaryCard label="Refund count" value={summary.refundCount} variant="number" />
          <SummaryCard label="Avg. refund" value={summary.avgRefund} currency={currency} />
        </s-stack>
      </s-section>

      <s-section heading="Refund trend">
        {timeseries.length === 0 ? (
          <s-text variation="subdued">No refunds detected in the selected window.</s-text>
        ) : (
          <s-data-table>
            <table>
              <thead>
                <tr>
                  <th align="left">Date</th>
                  <th align="right">Amount</th>
                  <th align="right">Count</th>
                </tr>
              </thead>
              <tbody>
                {timeseries.map((point) => (
                  <tr key={point.date}>
                    <td>{point.date}</td>
                    <td align="right">{formatCurrency(point.amount, currency)}</td>
                    <td align="right">{point.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-data-table>
        )}
      </s-section>

      <s-section heading="Top impacted products">
        {products.length === 0 ? (
          <s-text variation="subdued">No product level refunds to report.</s-text>
        ) : (
          <s-data-table>
            <table>
              <thead>
                <tr>
                  <th align="left">SKU</th>
                  <th align="left">Title</th>
                  <th align="right">Refund amount</th>
                  <th align="right">Refund count</th>
                  <th align="right">Units</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.sku}>
                    <td>{product.sku}</td>
                    <td>{product.title}</td>
                    <td align="right">{formatCurrency(product.amount, currency)}</td>
                    <td align="right">{product.count}</td>
                    <td align="right">{product.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-data-table>
        )}
      </s-section>

      <s-section heading="Refund reasons">
        {reasons.length === 0 ? (
          <s-text variation="subdued">No reason codes recorded.</s-text>
        ) : (
          <s-data-table>
            <table>
              <thead>
                <tr>
                  <th align="left">Reason</th>
                  <th align="right">Amount</th>
                  <th align="right">Count</th>
                </tr>
              </thead>
              <tbody>
                {reasons.map((reason) => (
                  <tr key={reason.reason}>
                    <td>{reason.reason}</td>
                    <td align="right">{formatCurrency(reason.amount, currency)}</td>
                    <td align="right">{reason.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-data-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Exports">
        <Form method="get" action="/app/refunds/export">
          <s-button type="submit" variant="secondary" fullWidth>
            Download refund detail CSV
          </s-button>
        </Form>
      </s-section>
    </s-page>
  );
}

function SummaryCard({ label, value, variant = "currency", currency }) {
  let displayValue;
  switch (variant) {
    case "percentage":
      displayValue = formatPercent(value, 2);
      break;
    case "number":
      displayValue = Number(value ?? 0).toLocaleString();
      break;
    case "currency":
    default:
      displayValue = formatCurrency(value, currency);
  }

  return (
    <s-card padding="base">
      <s-text variation="subdued">{label}</s-text>
      <s-display-text size="small">{displayValue}</s-display-text>
    </s-card>
  );
}

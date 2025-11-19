import { Form, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getOrderProfitTable } from "../services/reports.server";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";
import { formatCurrency, formatDateShort, formatPercent } from "../utils/formatting";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const includeRefunds = url.searchParams.get("refunds") !== "excluded";

  const orders = await getOrderProfitTable({
    store,
    rangeStart: parseDateInput(startParam),
    rangeEnd: parseDateInput(endParam),
    includeRefunds,
  });

  return {
    orders,
    currency: store.currency ?? "USD",
    filters: {
      start: startParam ?? "",
      end: endParam ?? "",
      includeRefunds,
    },
  };
};

function parseDateInput(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function OrdersPage() {
  const { orders, filters, currency } = useLoaderData();
  const [searchParams] = useSearchParams();
  const buildAppUrl = useAppUrlBuilder();
  const hostParam = searchParams.get("host");
  const shopParam = searchParams.get("shop");

  return (
    <s-page heading="Order profitability" subtitle="Per-order revenue, cost, and net margin">
      <s-section heading="Filters">
        <Form method="get">
          {hostParam && <input type="hidden" name="host" value={hostParam} />}
          {shopParam && <input type="hidden" name="shop" value={shopParam} />}
          <s-stack direction="inline" gap="base" wrap align="end">
            <label>
              Start date
              <input type="date" name="start" defaultValue={filters.start || ""} />
            </label>
            <label>
              End date
              <input type="date" name="end" defaultValue={filters.end || ""} />
            </label>
            <label>
              Refund handling
              <select name="refunds" defaultValue={filters.includeRefunds ? "included" : "excluded"}>
                <option value="included">Include refunds</option>
                <option value="excluded">Exclude refunded orders</option>
              </select>
            </label>
            <s-button type="submit" variant="primary">
              Apply
            </s-button>
            <s-button type="button" variant="tertiary" href={buildAppUrl("/app/orders")}>
              Reset
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Orders">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Order</th>
                <th align="left">Date</th>
                <th align="right">Revenue</th>
                <th align="right">COGS</th>
                <th align="right">Shipping</th>
                <th align="right">Fees</th>
                <th align="right">Advertising</th>
                <th align="right">Net profit</th>
                <th align="right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.orderNumber ?? order.shopifyOrderId}</td>
                  <td>{formatDateShort(order.processedAt)}</td>
                  <td align="right">{formatCurrency(order.revenue, order.currency ?? currency)}</td>
                  <td align="right">{formatCurrency(order.cogs, order.currency ?? currency)}</td>
                  <td align="right">{formatCurrency(order.shippingCost, order.currency ?? currency)}</td>
                  <td align="right">{formatCurrency(order.paymentFees + order.platformFees, order.currency ?? currency)}</td>
                  <td align="right">{formatCurrency(order.adSpend, order.currency ?? currency)}</td>
                  <td align="right">{formatCurrency(order.netProfit, order.currency ?? currency)}</td>
                  <td align="right">{formatPercent(order.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
        {!orders.length && (
          <s-text variation="subdued">No orders within the selected window.</s-text>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

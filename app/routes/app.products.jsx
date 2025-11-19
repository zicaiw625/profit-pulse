import { Form, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getProductProfitTable } from "../services/reports.server";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";
import { formatCurrency, formatPercent } from "../utils/formatting";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const sortParam = url.searchParams.get("sort") ?? "netProfit";

  const products = await getProductProfitTable({
    store,
    rangeStart: parseDateInput(startParam),
    rangeEnd: parseDateInput(endParam),
    sortBy: sortParam,
  });

  return {
    products,
    currency: store.currency ?? "USD",
    filters: {
      start: startParam ?? "",
      end: endParam ?? "",
      sort: sortParam,
    },
  };
};

function parseDateInput(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function ProductsPage() {
  const { products, filters, currency } = useLoaderData();
  const [searchParams] = useSearchParams();
  const buildAppUrl = useAppUrlBuilder();
  const hostParam = searchParams.get("host");
  const shopParam = searchParams.get("shop");
  const missingCostCount = products.filter((product) => product.missingCost).length;

  return (
    <s-page heading="Product profitability" subtitle="SKU level sales, COGS, and net profit">
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
              Sort by
              <select name="sort" defaultValue={filters.sort}>
                <option value="netProfit">Net profit</option>
                <option value="revenue">Revenue</option>
                <option value="margin">Net margin</option>
              </select>
            </label>
            <s-button type="submit" variant="primary">
              Apply
            </s-button>
            <s-button type="button" variant="tertiary" href={buildAppUrl("/app/products")}>
              Reset
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      {missingCostCount > 0 && (
        <s-section>
          <s-banner tone="warning" title="Some SKUs are missing costs">
            <s-text variation="subdued">
              {`${missingCostCount} SKU(s) have revenue but zero cost. Update their COGS to keep profit accurate.`}
            </s-text>
            <s-button variant="secondary" href={buildAppUrl("/app/settings#costs")}>
              Update costs
            </s-button>
          </s-banner>
        </s-section>
      )}

      <s-section heading="Products">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Product</th>
                <th align="right">Units</th>
                <th align="right">Revenue</th>
                <th align="right">COGS</th>
                <th align="right">Net profit</th>
                <th align="right">Net margin</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.sku}>
                  <td>
                    <strong>{product.title}</strong>
                    <br />
                    <s-text variation="subdued">{product.sku}</s-text>
                    {product.missingCost && (
                      <>
                        <br />
                        <s-badge tone="critical">Missing cost</s-badge>
                      </>
                    )}
                  </td>
                  <td align="right">{product.units.toLocaleString()}</td>
                  <td align="right">{formatCurrency(product.revenue, currency)}</td>
                  <td align="right">{formatCurrency(product.cogs, currency)}</td>
                  <td align="right">{formatCurrency(product.netProfit, currency)}</td>
                  <td align="right">{formatPercent(product.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
        {!products.length && (
          <s-text variation="subdued">No products found within the selected window.</s-text>
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

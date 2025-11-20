import { Form, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getProductProfitTable } from "../services/reports.server";
import { useAppUrlBuilder, APP_PRESERVED_PARAMS } from "../hooks/useAppUrlBuilder";
import { formatCurrency, formatPercent } from "../utils/formatting";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const sortParam = url.searchParams.get("sort") ?? "netProfit";

  const { rows, hasMissingCost } = await getProductProfitTable({
    store,
    rangeStart: parseDateInput(startParam),
    rangeEnd: parseDateInput(endParam),
    sortBy: sortParam,
  });

  return {
    products: rows,
    hasMissingCost,
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
  const { products, filters, currency, hasMissingCost } = useLoaderData();
  const [searchParams] = useSearchParams();
  const buildAppUrl = useAppUrlBuilder();
  const preservedFormParams = APP_PRESERVED_PARAMS.map((key) => {
    const value = searchParams.get(key);
    return value ? { key, value } : null;
  }).filter(Boolean);
  const missingCostCount = products.filter((product) => product.hasMissingCost).length;

  return (
    <s-page heading="Product profitability" subtitle="SKU level sales, COGS, and net profit">
      <s-section heading="Filters">
        <Form method="get">
          {preservedFormParams.map(({ key, value }) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
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

      {hasMissingCost && (
        <s-section>
          <s-banner tone="warning" title="部分 SKU 未配置成本">
            <s-text variation="subdued">
              {missingCostCount > 0
                ? `${missingCostCount} 个 SKU 未配置成本，利润统计可能不准确。`
                : "部分 SKU 未配置成本，利润统计可能不准确。"}
            </s-text>
            <s-button variant="secondary" href={buildAppUrl("/app/settings#costs")}>
              去补成本
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
                    {product.hasMissingCost && (
                      <>
                        <br />
                        <s-badge tone="critical">未配置成本，利润可能不准确</s-badge>
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
          <s-card padding="base" tone="info">
            <s-text variation="subdued">
              尚无商品利润数据，完成 Onboarding 或上传成本后即可看到排名。
            </s-text>
            <s-button variant="secondary" href={buildAppUrl("/app/onboarding")}>
              查看 Onboarding 清单
            </s-button>
          </s-card>
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

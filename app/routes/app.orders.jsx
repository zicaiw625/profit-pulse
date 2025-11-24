import { Form, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getOrderProfitTable } from "../services/reports.server";
import { useAppUrlBuilder, APP_PRESERVED_PARAMS } from "../hooks/useAppUrlBuilder";
import { formatCurrency, formatDateShort, formatPercent } from "../utils/formatting";
import { useLocale } from "../hooks/useLocale";

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
  const { lang } = useLocale();
  const copy = ORDERS_COPY[lang] ?? ORDERS_COPY.en;
  const preservedFormParams = APP_PRESERVED_PARAMS.map((key) => {
    const value = searchParams.get(key);
    return value ? { key, value } : null;
  }).filter(Boolean);

  return (
    <s-page heading={copy.heading} subtitle={copy.subtitle}>
      <s-section heading={copy.filtersHeading}>
        <Form method="get">
          {preservedFormParams.map(({ key, value }) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <s-stack direction="inline" gap="base" wrap align="end">
            <label>
              {copy.startDate}
              <input type="date" name="start" defaultValue={filters.start || ""} />
            </label>
            <label>
              {copy.endDate}
              <input type="date" name="end" defaultValue={filters.end || ""} />
            </label>
            <label>
              {copy.refundHandling}
              <select name="refunds" defaultValue={filters.includeRefunds ? "included" : "excluded"}>
                <option value="included">{copy.includeRefunds}</option>
                <option value="excluded">{copy.excludeRefunds}</option>
              </select>
            </label>
            <s-button type="submit" variant="primary">
              {copy.apply}
            </s-button>
            <s-button type="button" variant="tertiary" href={buildAppUrl("/app/orders")}>
              {copy.reset}
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading={copy.tableHeading}>
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">{copy.columns.order}</th>
                <th align="left">{copy.columns.date}</th>
                <th align="right">{copy.columns.revenue}</th>
                <th align="right">{copy.columns.cogs}</th>
                <th align="right">{copy.columns.shipping}</th>
                <th align="right">{copy.columns.fees}</th>
                <th align="right">{copy.columns.advertising}</th>
                <th align="right">{copy.columns.netProfit}</th>
                <th align="right">{copy.columns.margin}</th>
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
          <s-card padding="base" tone="info">
            <s-text variation="subdued">
              {copy.emptyState}
            </s-text>
            <s-button variant="secondary" href={buildAppUrl("/app/onboarding")}>
              {copy.emptyStateCta}
            </s-button>
          </s-card>
        )}
      </s-section>
    </s-page>
  );
}

const ORDERS_COPY = {
  en: {
    heading: "Order profitability",
    subtitle: "Per-order revenue, cost, and net margin",
    filtersHeading: "Filters",
    startDate: "Start date",
    endDate: "End date",
    refundHandling: "Refund handling",
    includeRefunds: "Include refunds",
    excludeRefunds: "Exclude refunded orders",
    apply: "Apply",
    reset: "Reset",
    tableHeading: "Orders",
    columns: {
      order: "Order",
      date: "Date",
      revenue: "Revenue",
      cogs: "COGS",
      shipping: "Shipping",
      fees: "Fees",
      advertising: "Advertising",
      netProfit: "Net profit",
      margin: "Margin",
    },
    emptyState: "No orders yet. Finish onboarding or wait for sync to complete to see results.",
    emptyStateCta: "View onboarding checklist",
  },
  zh: {
    heading: "订单利润",
    subtitle: "逐单营收、成本与净利率",
    filtersHeading: "筛选条件",
    startDate: "起始日期",
    endDate: "结束日期",
    refundHandling: "退款处理",
    includeRefunds: "包含退款订单",
    excludeRefunds: "排除退款订单",
    apply: "应用",
    reset: "重置",
    tableHeading: "订单列表",
    columns: {
      order: "订单",
      date: "日期",
      revenue: "营收",
      cogs: "成本",
      shipping: "运费",
      fees: "手续费",
      advertising: "广告",
      netProfit: "净利润",
      margin: "净利率",
    },
    emptyState: "尚无订单数据，完成 Onboarding 或稍等同步即可看到结果。",
    emptyStateCta: "查看 Onboarding 清单",
  },
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

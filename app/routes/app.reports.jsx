/* eslint-disable react/prop-types */
import { Form, useLoaderData, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getAdPerformanceBreakdown, getReportingOverview } from "../services/reports.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  formatCurrency,
  formatPercent,
  formatRatio,
  formatChannelLabel,
  formatDateShort,
} from "../utils/formatting";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const [report, adPerformance] = await Promise.all([
    getReportingOverview({ storeId: store.id, rangeDays: 30 }),
    getAdPerformanceBreakdown({ storeId: store.id, rangeDays: 30 }),
  ]);
  return { report, adPerformance };
};

export default function ReportsPage() {
  const { report, adPerformance } = useLoaderData();
  const currency = report.currency ?? "USD";
  const rangeLabel = `${formatDateShort(report.range.start)} – ${formatDateShort(report.range.end)}`;

  return (
    <s-page heading="Performance reports" subtitle={`Last 30 days · ${rangeLabel}`}>
      <s-section heading="Summary">
        <s-stack direction="inline" gap="base" wrap>
          <SummaryCard label="Revenue" value={report.summary.revenue} currency={currency} />
          <SummaryCard label="Net profit" value={report.summary.netProfit} currency={currency} />
          <SummaryCard label="Fixed costs" value={report.summary.fixedCosts} currency={currency} />
          <SummaryCard label="Net profit (after fixed)" value={report.summary.netProfitAfterFixed} currency={currency} />
          <SummaryCard label="Ad spend" value={report.summary.adSpend} currency={currency} />
          <SummaryCard label="Net margin" value={report.summary.netMargin} variant="percentage" />
          <SummaryCard
            label="Net margin (after fixed)"
            value={report.summary.netMarginAfterFixed}
            variant="percentage"
          />
          <SummaryCard
            label="MER"
            value={report.summary.mer ?? 0}
            variant="ratio"
            fallback="—"
          />
          <SummaryCard
            label="NPAS"
            value={report.summary.npas ?? 0}
            variant="ratio"
            fallback="—"
          />
          <SummaryCard label="Refund amount" value={report.summary.refundAmount} currency={currency} />
          <SummaryCard label="Refund rate" value={report.summary.refundRate} variant="percentage" />
        </s-stack>
      </s-section>

      <s-section heading="Channel performance">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Channel</th>
                <th align="right">Revenue</th>
                <th align="right">Ad spend</th>
                <th align="right">MER</th>
                <th align="right">NPAS</th>
                <th align="right">Net profit</th>
                <th align="right">Margin</th>
                <th align="right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {report.channels.map((channel) => (
                <tr key={channel.channel}>
                <td>{formatChannelLabel(channel.channel)}</td>
                  <td align="right">{formatCurrency(channel.revenue, currency, 0)}</td>
                  <td align="right">{formatCurrency(channel.adSpend, currency, 0)}</td>
                  <td align="right">{formatRatio(channel.mer)}</td>
                  <td align="right">{formatRatio(channel.npas)}</td>
                  <td align="right">{formatCurrency(channel.netProfit, currency, 0)}</td>
                  <td align="right">{formatPercent(channel.margin)}</td>
                  <td align="right">{channel.orders.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section heading="Top products by revenue">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">SKU</th>
                <th align="right">Revenue</th>
                <th align="right">Net profit</th>
              <th align="right">Ad spend</th>
              <th align="right">Orders</th>
              <th align="right">Units</th>
              <th align="right">Margin</th>
              <th align="right">Refund rate</th>
            </tr>
          </thead>
          <tbody>
            {report.products.map((product) => (
              <tr key={product.sku}>
                <td>{product.sku}</td>
                <td align="right">{formatCurrency(product.revenue, currency, 0)}</td>
                <td align="right">{formatCurrency(product.netProfit, currency, 0)}</td>
                <td align="right">{formatCurrency(product.adSpend, currency, 0)}</td>
                <td align="right">{product.orders.toLocaleString()}</td>
                <td align="right">{product.units.toLocaleString()}</td>
                <td align="right">{formatPercent(product.margin)}</td>
                <td align="right">{formatPercent(product.refundRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </s-data-table>
      </s-section>

      <s-section heading="Ad performance (campaign / ad set / ad)">
        {adPerformance.providers.length === 0 && (
          <s-text variation="subdued">
            No ad spend records yet. Connect Meta or Google Ads on the Settings page to track campaign profitability.
          </s-text>
        )}
        <s-stack direction="block" gap="base">
          {adPerformance.providers.map((provider) => (
            <s-card key={provider.provider} padding="base">
                <s-heading>
                {provider.label} · Spend {formatCurrency(provider.spend, adPerformance.currency ?? currency, 0)} · Revenue {formatCurrency(provider.revenue, adPerformance.currency ?? currency, 0)} · Net profit {formatCurrency(provider.netProfit, adPerformance.currency ?? currency, 0)}
              </s-heading>
              <s-data-table>
                <table>
                  <thead>
                    <tr>
                      <th align="left">Campaign</th>
                      <th align="left">Ad set</th>
                      <th align="left">Ad</th>
                      <th align="right">Spend</th>
                      <th align="right">Impr.</th>
                      <th align="right">Clicks</th>
                      <th align="right">Conv.</th>
                      <th align="right">Est. revenue</th>
                      <th align="right">Est. net profit</th>
                      <th align="right">MER</th>
                      <th align="right">NPAS</th>
                      <th align="right">CPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.rows.map((row) => (
                      <tr key={`${row.provider}-${row.campaignId}-${row.adSetId}-${row.adId}`}>
                        <td>{row.campaignName ?? row.campaignId ?? "—"}</td>
                        <td>{row.adSetName ?? row.adSetId ?? "—"}</td>
                        <td>{row.adName ?? row.adId ?? "—"}</td>
                        <td align="right">{formatCurrency(row.spendConverted ?? row.spend, adPerformance.currency ?? currency, 0)}</td>
                        <td align="right">{row.impressions.toLocaleString()}</td>
                        <td align="right">{row.clicks.toLocaleString()}</td>
                        <td align="right">{row.conversions.toLocaleString()}</td>
                        <td align="right">{formatCurrency(row.estimatedRevenue, adPerformance.currency ?? currency, 0)}</td>
                        <td align="right">{formatCurrency(row.estimatedNetProfit, adPerformance.currency ?? currency, 0)}</td>
                        <td align="right">{formatRatio(row.mer)}</td>
                        <td align="right">{formatRatio(row.npas)}</td>
                        <td align="right">{row.cpa ? formatCurrency(row.cpa, adPerformance.currency ?? currency, 0) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </s-data-table>
            </s-card>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Exports">
        <s-stack direction="block" gap="base">
          <Form method="get" action="/app/reports/export/channels">
            <s-button type="submit" variant="secondary" fullWidth>
              Download channel performance CSV
            </s-button>
          </Form>
          <Form method="get" action="/app/reports/export/products">
            <s-button type="submit" variant="secondary" fullWidth>
              Download product profitability CSV
            </s-button>
          </Form>
          <Form method="get" action="/app/reports/export/net-profit">
            <s-button type="submit" variant="secondary" fullWidth>
              Download net profit vs. spend CSV
            </s-button>
          </Form>
          <Form method="get" action="/app/reports/export/ads">
            <s-button type="submit" variant="secondary" fullWidth>
              Download ad performance CSV
            </s-button>
          </Form>
          <Form method="get" action="/app/reports/export/accounting">
            <s-button type="submit" variant="secondary" fullWidth>
              Download accounting CSV
            </s-button>
          </Form>
        </s-stack>
      </s-section>
      <s-section slot="aside" heading="Coming soon">
        <s-unordered-list>
          <s-list-item>Refund impact report</s-list-item>
          <s-list-item>Ad cohort performance</s-list-item>
          <s-list-item>Custom report builder</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

function SummaryCard({ label, value, variant = "currency", fallback, currency = "USD" }) {
  let displayValue;
  if (variant === "currency") {
    displayValue = formatCurrency(value, currency, 0);
  } else if (variant === "percentage") {
    displayValue = formatPercent(value);
  } else if (variant === "ratio") {
    displayValue = formatRatio(value, 2, fallback ?? "—");
  } else {
    displayValue = value?.toLocaleString?.() ?? value ?? "—";
  }

  return (
    <s-card padding="base">
      <s-text variation="subdued">{label}</s-text>
      <s-display-text size="small">{displayValue}</s-display-text>
    </s-card>
  );
}

function formatChannel(channel) {
  if (!channel) return "Unknown";
  return channel.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

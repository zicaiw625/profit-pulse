import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import {
  getReportingOverview,
  getNetProfitVsSpendSeries,
  getAdPerformanceBreakdown,
} from "../services/reports.server";
import {
  formatChannelLabel,
  formatDateShort,
  formatDecimal,
  formatPercent,
  formatRatio,
} from "../utils/formatting";
import { getAccountingMonthlySummary } from "../services/accounting.server";

const EXPORT_BUILDERS = {
  channels: buildChannelCsv,
  products: buildProductCsv,
  "net-profit": buildNetProfitCsv,
  ads: buildAdsCsv,
  accounting: buildAccountingCsv,
};

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const type = (params.type || "").toLowerCase();

  const builder = EXPORT_BUILDERS[type];
  if (!builder) {
    throw new Response("Export type not found", { status: 404 });
  }

  const { filename, content } = await builder({ storeId: store.id });

  return new Response(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};

async function buildChannelCsv({ storeId }) {
  const report = await getReportingOverview({ storeId });
    const headers = [
      "Channel",
      "Revenue",
      "Ad Spend",
      "MER",
      "NPAS",
      "Net Profit",
      "Margin",
      "Orders",
    ];

    const rows = report.channels.map((channel) => [
      formatChannelLabel(channel.channel),
      formatDecimal(channel.revenue),
      formatDecimal(channel.adSpend),
      formatRatio(channel.mer, 2, ""),
      formatRatio(channel.npas, 2, ""),
      formatDecimal(channel.netProfit),
      formatPercent(channel.margin, 2),
      Number(channel.orders ?? 0),
    ]);

  return {
    filename: `channels-${dateStamp(report.range)}.csv`,
    content: buildCsv(headers, rows),
  };
}

async function buildProductCsv({ storeId }) {
  const report = await getReportingOverview({ storeId });
  const headers = [
    "SKU",
    "Revenue",
    "Net Profit",
    "Ad Spend",
    "Orders",
    "Units",
    "Margin",
  ];

    const rows = report.products.map((product) => [
      product.sku,
      formatDecimal(product.revenue),
      formatDecimal(product.netProfit),
      formatDecimal(product.adSpend),
      Number(product.orders ?? 0),
      Number(product.units ?? 0),
      formatPercent(product.margin, 2),
    ]);

  return {
    filename: `products-${dateStamp(report.range)}.csv`,
    content: buildCsv(headers, rows),
  };
}

async function buildNetProfitCsv({ storeId }) {
  const { range, points } = await getNetProfitVsSpendSeries({ storeId });
    const headers = ["Date", "Revenue", "Ad Spend", "Net Profit"];
    const rows = points.map((row) => [
      row.date,
      formatDecimal(row.revenue),
      formatDecimal(row.adSpend),
      formatDecimal(row.netProfit),
    ]);

  return {
    filename: `net-profit-${dateStamp(range)}.csv`,
    content: buildCsv(headers, rows),
  };
}

async function buildAdsCsv({ storeId }) {
  const report = await getAdPerformanceBreakdown({ storeId });
    const headers = [
      "Provider",
      "Campaign",
      "Ad Set",
      "Ad",
      "Spend",
      "Impressions",
      "Clicks",
      "Conversions",
      "Estimated Revenue",
      "Estimated Net Profit",
      "MER",
      "NPAS",
      "CPA",
    ];

    const rows = [];
    report.providers.forEach((provider) => {
      provider.rows.forEach((row) => {
        rows.push([
          provider.label,
          row.campaignName ?? row.campaignId ?? "—",
          row.adSetName ?? row.adSetId ?? "—",
          row.adName ?? row.adId ?? "—",
          formatDecimal(row.spendConverted ?? row.spend),
          Number(row.impressions ?? 0),
          Number(row.clicks ?? 0),
          Number(row.conversions ?? 0),
          formatDecimal(row.estimatedRevenue),
          formatDecimal(row.estimatedNetProfit),
          formatRatio(row.mer, 2, ""),
          formatRatio(row.npas, 2, ""),
          row.cpa ? formatDecimal(row.cpa) : "",
        ]);
      });
    });

  return {
    filename: `ad-performance-${dateStamp(report.range)}.csv`,
    content: buildCsv(headers, rows),
  };
}

async function buildAccountingCsv({ storeId }) {
  const { rows, currency, range } = await getAccountingMonthlySummary({
    storeId,
    months: 6,
  });
  const headers = [
    "Month",
    "Revenue",
    "COGS",
    "Shipping",
    "Payment fees",
    "Refund amount",
    "Ad spend",
    "Net profit",
    "Orders",
  ];
  const dataRows = rows.map((row) => [
    row.month,
    formatDecimal(row.revenue),
    formatDecimal(row.cogs),
    formatDecimal(row.shippingCost),
    formatDecimal(row.paymentFees),
    formatDecimal(row.refundAmount),
    formatDecimal(row.adSpend),
    formatDecimal(row.netProfit),
    Number(row.orders ?? 0),
  ]);

  return {
    filename: `accounting-${dateStamp(range)}.csv`,
    content: buildCsv(headers, dataRows),
  };
}

function buildCsv(headers, rows) {
  const lines = [];
  lines.push(headers.map(csvSafe).join(","));
  rows.forEach((row) => {
    lines.push(row.map(csvSafe).join(","));
  });
  return lines.join("\n");
}

function csvSafe(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if ([",", "\n", '"'].some((char) => stringValue.includes(char))) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function dateStamp(range) {
  const start = formatDateShort(range?.start ?? range?.end);
  const end = formatDateShort(range?.end ?? range?.start);
  return `${start || "start"}-${end || "end"}`;
}

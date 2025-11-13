import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import {
  getReportingOverview,
  getNetProfitVsSpendSeries,
  getAdPerformanceBreakdown,
  getCustomReportData,
} from "../services/reports.server";
import { getAccountingMonthlySummary, getAccountingDetailRows } from "../services/accounting.server";
import { listTaxRates } from "../services/tax-rates.server";
import {
  formatChannelLabel,
  formatDateShort,
  formatDecimal,
  formatPercent,
  formatRatio,
} from "../utils/formatting";
import { logAuditEvent } from "../services/audit.server";

const EXPORT_BUILDERS = {
  channels: buildChannelCsv,
  products: buildProductCsv,
  "net-profit": buildNetProfitCsv,
  ads: buildAdsCsv,
  accounting: buildAccountingCsv,
  custom: buildCustomCsv,
  "accounting-detailed": buildAccountingDetailedCsv,
  "tax-template": buildTaxTemplateCsv,
  quickbooks: buildQuickbooksCsv,
  xero: buildXeroCsv,
};

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const type = (params.type || "").toLowerCase();

  const builder = EXPORT_BUILDERS[type];
  if (!builder) {
    throw new Response("Export type not found", { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const { filename, content } = await builder({
    storeId: store.id,
    searchParams,
  });

  await logAuditEvent({
    merchantId: store.merchantId,
    userEmail: session.email,
    action: "export_report_csv",
    details: `Exported ${type} report for ${store.shopDomain}`,
  });

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

async function buildCustomCsv({ storeId, searchParams }) {
  const dimension = searchParams.get("dimension") ?? undefined;
  const metricsParam = searchParams.get("metrics");
  const metrics = metricsParam
    ? metricsParam.split(",").map((item) => item.trim()).filter(Boolean)
    : undefined;
  const rangeStart = searchParams.get("start") ?? undefined;
  const rangeEnd = searchParams.get("end") ?? undefined;
  const limit = Number(searchParams.get("limit")) || 25;

  const report = await getCustomReportData({
    storeId,
    dimension,
    metrics,
    start: rangeStart,
    end: rangeEnd,
    limit,
  });

  const headers = [
    report.dimension.label,
    ...report.metrics.map((metric) => metric.label),
  ];
  const rows = report.rows.map((row) => [
    row.dimensionValue,
    ...row.metrics.map((metric) =>
      metric.isCurrency
        ? formatDecimal(metric.value)
        : Number(metric.value ?? 0).toLocaleString(),
    ),
  ]);

  return {
    filename: `custom-${report.dimension.key}-${dateStamp(report.range)}.csv`,
    content: buildCsv(headers, rows),
  };
}

async function buildAccountingDetailedCsv({ storeId, searchParams }) {
  const rangeStart = searchParams.get("start") ?? undefined;
  const rangeEnd = searchParams.get("end") ?? undefined;
  const { rows, range } = await getAccountingDetailRows({
    storeId,
    start: rangeStart,
    end: rangeEnd,
  });

  const headers = [
    "Date",
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
    formatDateShort(row.date),
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
    filename: `accounting-detail-${dateStamp(range)}.csv`,
    content: buildCsv(headers, dataRows),
  };
}

async function buildTaxTemplateCsv({ storeId }) {
  const rates = await listTaxRates(storeId);
  const defaultRows =
    rates.length > 0
      ? rates
      : [
          {
            country: "United States",
            state: "CA",
            rate: 7.25,
            effectiveFrom: null,
            effectiveTo: null,
            notes: "Example rate",
          },
          {
            country: "Canada",
            state: "ON",
            rate: 13,
            effectiveFrom: null,
            effectiveTo: null,
            notes: "Example rate",
          },
        ];
  const headers = ["Country", "State", "Rate", "Effective from", "Effective to", "Notes"];
  const dataRows = defaultRows.map((row) => [
    row.country,
    row.state ?? "",
    formatDecimal(row.rate),
    row.effectiveFrom ? formatDateShort(new Date(row.effectiveFrom)) : "",
    row.effectiveTo ? formatDateShort(new Date(row.effectiveTo)) : "",
    row.notes ?? "",
  ]);

  return {
    filename: `tax-template-${new Date().toISOString().slice(0, 10)}.csv`,
    content: buildCsv(headers, dataRows),
  };
}

async function buildQuickbooksCsv({ storeId, searchParams }) {
  const rangeStart = searchParams.get("start") ?? undefined;
  const rangeEnd = searchParams.get("end") ?? undefined;
  const { rows, currency, range } = await getAccountingDetailRows({
    storeId,
    start: rangeStart,
    end: rangeEnd,
  });

  const headers = ["Date", "Account", "Debit", "Credit", "Memo", "Currency"];
  const dataRows = [];
  rows.forEach((row) => {
    const dateLabel = formatDateShort(row.date);
    dataRows.push([
      dateLabel,
      "Sales",
      "",
      formatDecimal(row.revenue),
      "Revenue",
      currency,
    ]);
    dataRows.push([
      dateLabel,
      "Cost of Goods Sold",
      formatDecimal(row.cogs),
      "",
      "COGS",
      currency,
    ]);
    dataRows.push([
      dateLabel,
      "Shipping Expense",
      formatDecimal(row.shippingCost),
      "",
      "Shipping",
      currency,
    ]);
    dataRows.push([
      dateLabel,
      "Payment Fees",
      formatDecimal(row.paymentFees),
      "",
      "Payment processing fees",
      currency,
    ]);
    dataRows.push([
      dateLabel,
      "Refunds",
      formatDecimal(row.refundAmount),
      "",
      "Refund impact",
      currency,
    ]);
    dataRows.push([
      dateLabel,
      "Advertising Expense",
      formatDecimal(row.adSpend),
      "",
      "Ad spend allocation",
      currency,
    ]);
  });

  return {
    filename: `quickbooks-${dateStamp(range)}.csv`,
    content: buildCsv(headers, dataRows),
  };
}

async function buildXeroCsv({ storeId, searchParams }) {
  const rangeStart = searchParams.get("start") ?? undefined;
  const rangeEnd = searchParams.get("end") ?? undefined;
  const { rows, currency, range } = await getAccountingDetailRows({
    storeId,
    start: rangeStart,
    end: rangeEnd,
  });

  const headers = [
    "Date",
    "Type",
    "Reference",
    "Account",
    "Description",
    "Tax",
    "Amount",
    "Currency",
  ];
  const dataRows = rows.map((row, index) => [
    formatDateShort(row.date),
    "Journal",
    `P&L-${index + 1}`,
    "Net Profit",
    "Net operating profit",
    "NONE",
    formatDecimal(row.netProfit),
    currency,
  ]);

  return {
    filename: `xero-${dateStamp(range)}.csv`,
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

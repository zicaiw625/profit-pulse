export const HELP_ONBOARDING_ITEMS = [
  "Confirm Shopify OAuth install and let the app sync your first orders.",
  "Connect Meta Ads / Google Ads credentials in Settings so ad spend flows into dashboards.",
  "Upload SKU costs and seed fixed cost templates to give the profit engine accurate inputs.",
  "Enable Slack alerts or report schedules to keep your team informed of drops in revenue or spikes in refunds.",
];

export const HELP_METRIC_DEFINITIONS = [
  {
    title: "Revenue & cost basics",
    description:
      "Revenue = product sales – discounts + shipping + tax. COGS includes per-SKU costs, shipping templates, and payment fees.",
  },
  {
    title: "Profitability & efficiency",
    description:
      "Gross profit subtracts direct costs, while net profit deducts platform fees, custom costs, and allocated fixed costs. MER and NPAS compare revenue/net profit to ad spend to highlight returns.",
  },
  {
    title: "Refunds & reconciliation",
    description:
      "Refund rate is refunded orders ÷ total orders. Reconciliation checks Shopify vs. payments or ad conversion counts and surfaces discrepancies for review.",
  },
];

export const HELP_SYNC_ITEMS = [
  "Shopify orders, refunds, and webhooks drive the profit engine; run manual syncs via Settings if you added historical data.",
  "Ad spend records (Meta/Google) are pulled per campaign → aggregated to daily metrics and matched to channel revenue.",
  "Shopify Payments payouts and PayPal fee imports let the reconciliation engine highlight payment gaps.",
  "Fixed costs, notification channels, and report schedules are stored per merchant so every store shares a consistent plan.",
];

export const HELP_LINKS = [
  {
    title: "Need deeper context?",
    description:
      "Reference docs/architecture.md for the current module map, data flow, and planned phases.",
  },
  {
    title: "Report scheduling",
    description:
      "Use the Settings > Report schedules section to register recipients and cadence for your daily/weekly digests.",
    link: { href: "/app/settings", label: "Settings > Report schedules" },
  },
  {
    title: "Need to revisit the dashboard?",
    description: "Go back to the Overview dashboard for the latest cards, timeseries, and product rankings.",
    link: { href: "/app", label: "Overview dashboard" },
  },
];

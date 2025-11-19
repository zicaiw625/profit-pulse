# V1 feature map

The Profit Pulse V1 scope targets the “Shopify 利润 & 对账工具” checklist included in the product brief. Each section below lists the implemented capability and the files that implement it.

## 1. Accounts & billing
- **Shopify OAuth + multi-store** – `ensureMerchantAndStore` (`app/models/store.server.js`) provisions a workspace per owner email, reuses merchants across installs, and enforces Basic/Pro store limits.
- **Shopify Billing (Basic/Pro + 14-day trial)** – Plans live in `app/config/billing.js`. `app/services/billing.server.js` syncs subscription webhooks and issues plan change requests.
- **Plan usage enforcement** – `app/services/plan-limits.server.js` tracks monthly order usage (`MonthlyOrderUsage` table) and blocks ingestion when caps are hit. Settings shows usage via `PlanUsageCard`.

## 2. Data sources
- **Shopify orders/refunds** – Webhooks under `app/routes/webhooks.*` call `processShopifyOrder` (`app/services/profit-engine.server.js`) to persist orders, line items, costs, and refunds.
- **Incremental sync** – Manual jobs in `app/services/sync/shopify-orders.server.js` support 60-day backfills and 10–15 minute polling for late data.
- **Meta Ads** – The only advertising connector in V1 (`app/services/connectors/meta-ads.server.js`) feeds `syncAdProvider` which writes `AdSpendRecord` rows and daily metric spend.
- **Payments** – Shopify Payments payouts sync via `syncShopifyPayments` (REST Admin API). PayPal imports rely on `app/services/payments/paypal.server.js` plus template-based fee estimates.

## 3. Cost configuration
- **SKU / CSV COGS** – `app/services/costs.server.js` provides CRUD helpers plus `importSkuCostsFromCsv`. Settings exposes upload + demo seeding buttons.
- **Payment & platform fee templates** – Configurable via Settings; consumed by `processShopifyOrder` to apply per-order costs.
- **Global platform commission** – Stored as a `CostTemplate` entry and applied across all orders per store.

## 4. Profit engine
- **Unified currency** – `app/services/exchange-rates.server.js` caches FX rates; `processShopifyOrder` converts multi-currency orders into the merchant currency.
- **Per-order profitability** – Revenue, COGS, shipping templates, payment fees, platform fees, and Meta Ads allocation (equal split for duplicate IDs) all roll into `OrderCost`, `OrderAttribution`, and `DailyMetric`.
- **Aggregation** – `app/services/dashboard.server.js` reads daily metrics, summarises cards, time-series, cost composition, and SKU rankings for `/app`.

## 5. Dashboards & reports
- **Dashboard (`/app`)** – `app/routes/app._index.jsx` renders metric cards, revenue/profit/ad spend sparklines, cost composition, plan usage, and top SKU table with filters (Today/7/30/custom).
- **Order profit table** – `app/routes/app.orders.jsx` surfaces order-level revenue/COGS/fees/ads/net profit with date + refund filters.
- **Product profit table** – `app/routes/app.products.jsx` aggregates SKU sales, COGS, net profit, and margin with sorting.

## 6. Reconciliation
- **Payments vs Shopify** – `app/services/reconciliation.server.js` compares daily order totals vs. Shopify Payments payouts (and PayPal templates) and creates `ReconciliationIssue` entries.
- **Ads vs Shopify** – Daily Meta conversions vs. Shopify orders generate issues when conversion count diverges above the threshold.
- **UI** – `/app/reconciliation` lists open issues with type, amount deltas, and timestamps.

## 7. Onboarding, help, and legal
- **In-app onboarding** – `/app/onboarding` lists the four V1 steps (connect Shopify, connect Meta Ads, import COGS, set currency/exchange mode).
- **Help center** – `/app/help` renders FAQs, metric definitions, sync cadence, and links to privacy/terms.
- **Privacy & terms** – Static routes `/app/privacy` and `/app/terms` cover basic compliance requirements.

## 8. Security & operations
- **Credential encryption** – All Meta Ads and PayPal tokens are encrypted via `CREDENTIAL_ENCRYPTION_KEY` (`app/services/credentials.server.js`).
- **Plan limits** – Usage locks rows with `FOR UPDATE` semantics in `plan-limits.server.js`.
- **Environment hardening** – Refer to [ENVIRONMENT.md](../ENVIRONMENT.md) for required secrets (Shopify, Meta, PayPal) and optional cache/exchange rate overrides.

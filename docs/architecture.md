# Profit Pulse – Phase 1 Architecture

## Product Goals
- Provide Shopify merchants with a unified view of revenue, costs, and profitability across stores, ad channels, and payment providers.
- Deliver trustworthy reconciliations between Shopify, ads, and payment processors so discrepancies are surfaced quickly.
- Offer actionable dashboards and alerts that highlight profitability trends, problem products, and channels.

## System Overview
- **Frontend**: Shopify embedded app built with React Router + Polaris web components (running inside the Shopify Admin iframe via App Bridge).
- **Backend**: Node/Express handlers exposed through React Router loaders/actions; Prisma ORM for persistence.
- **Background Workloads**: A worker process (can run as separate Node service or background queue) handles ingest/sync, reconciliation, scheduled reports, and notifications.
- **Storage**: Primary relational database (SQLite for dev; plan for MySQL/Postgres in production). Object storage (S3/GCS) for CSV imports and report exports.
- **Queues & Scheduling**: BullMQ / Cloud task runner for long-running sync jobs, cron-based scheduler (ex. `@shopify/cli` background task or hosted worker) for periodic pulls.

```
Shopify Admin <iframe> ──App Bridge──> React Router frontend
            │                                │
            │                       fetch loaders/actions
            ▼                                │
      Backend API (Node + Prisma) <──────────┘
            │
            ├─ Shopify Admin GraphQL/REST
            ├─ Billing API
            ├─ Ad APIs (Meta, Google) via worker
            ├─ Payment APIs (Shopify Payments, PayPal, Stripe…)
            └─ Storage/Queue for data sync + reports
```

## Module Breakdown

### 1. Accounts & Stores
- Shopify OAuth install flow bootstraps the **Account** and **Store** records; support multi-store linking per owner.
- Team management (Owner/Finance/Marketing) stored via `TeamMember` table with role-based gates in frontend.
- Subscriptions handled with Shopify Billing API: Basic vs. Pro plans + usage-based overages (orders/store count). Trial flag stored on `Subscription`.

### 2. Data Sources
- **Shopify**: Webhooks (orders/create, orders/updated, refunds, fulfillments) push deltas; nightly backfill job to ensure completeness. Normalized entities: `Order`, `OrderLine`, `Transaction`, `ShippingLine`, `Discount`.
- **Ads**: OAuth tokens per provider saved in `AdAccountCredential`. Workers fetch spend & conversions at Campaign/AdSet/Ad granularity.
- **Payments**: Shopify Payments via Admin APIs; PayPal/Stripe via native APIs when configured. Store fees per transaction for reconciliation.

The codebase now includes a sync framework:
- `AdSpendRecord`, `PaymentPayout`, `SyncJob` tables capture normalized data and job telemetry.
- Connectors (`app/services/sync/*.server.js`) orchestrate provider-specific fetchers, persist aggregates, and update `DailyMetric` ad spend.
- Settings UI exposes manual "Sync now" actions per provider until background schedulers are wired up.
- **Logistics/COGS Inputs**: CSV uploads or API connectors populate `SkuCost`, `ShippingRule`, `CustomCostItem`.
- **Exchange Rates/Tax Rates**: Daily fetch from fixer.io/ECB (pluggable provider) + merchant overrides.

### 3. Cost Configuration
- SKU/variant level cost table with effective date ranges (batch support) plus optional ERP sync.
- Variable cost templates applied per order (payment fees, platform commissions, customizable formulas).
- Fixed costs recorded monthly and allocated across stores by rule (orders, revenue, channel weight).

### 4. Profit Engine
- Order pipeline calculates: revenue, direct costs (COGS, shipping, payment, platform), allocated ad spend, resulting gross/net profit & margin.
- Attribution adapter: default last-touch from ad platform; plug-in interface for custom windows or weighted splits.
- Aggregations persisted in `MetricDaily` for quick dashboard queries (by date, store, channel, product). Additional dims (geo, customer) stored as needed.
- Multi-currency: store raw values in source currency, convert to master currency using rate snapshot; maintain `MoneyValue` composite fields.

### 5. Reporting & Dashboards
- Home dashboard cards + line/pie charts sourced from pre-aggregated metrics with flexible date filters.
- Product profitability table, channel/ad reports with ROAS & Net Profit on Ad Spend.
- Refund analytics, variance explanations, CSV export endpoints. Later phases add custom report builder.

### 6. Reconciliation & Alerts
- Automated checks between Shopify orders vs. payment processor payouts, and Shopify vs. ad-reported conversions. Diff records stored for UI.
- Current build runs payout/ad conversion detectors on-demand (and eventually via cron) to populate `ReconciliationIssue`.
- Alerting rules engine monitors profitability drops, negative ROAS, fee anomalies. Notifications via email (phase 1) and Slack/Teams later.
- Accounting export service emits monthly P&L CSV formatted for bookkeeping systems, extensible to QuickBooks/Xero integrations.

### 7. Onboarding & Help
- Post-install wizard drives store connection, ad auth, COGS import, base currency/timezone selection.
- Mock data preview available until first sync completes.
- Tooltips reference formula definitions; embedded FAQ/help center page for troubleshooting.

### 8. Security & Compliance
- Sessions stored via Prisma `Session` table; scoped JWT cookies for internal APIs.
- Encrypt API credentials at rest (KMS/Env key). Audit log for data exports/downloads.
- Provide Privacy Policy/ToS routes; ensure GDPR/CCPA compliance for data deletion requests.

## Phase Plan
1. **Phase 1 - Core (Current focus)**
   - Shopify OAuth + multi-store, Basic/Pro subscription scaffold.
   - Shopify order sync (webhook + nightly backfill), Shopify Payments fees ingestion.
   - COGS + variable cost templates; base currency/timezone settings.
   - Profit calculation service + metric aggregation.
   - Core dashboard, product & channel reports, Shopify vs. payments reconciliation, email summaries.
2. **Phase 2 - Advanced**
   - Team roles/permissions, trials & overage billing, PayPal/Stripe fees, Meta/Google ad connectors, fixed cost allocation, refund deep dives, Slack/Zapier notifications.
3. **Phase 3 - Premium**
   - Additional ad networks, logistics provider integrations, advanced anomaly detection, accounting software sync, drag-and-drop custom reporting, multi-language UX.

This architecture doc anchors implementation priorities and ensures new modules map cleanly onto the data model and worker topology as we begin coding Phase 1.

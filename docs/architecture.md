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
            ├─ Ad API (Meta) via worker
            ├─ Payment APIs (Shopify Payments, PayPal)
            └─ Storage/Queue for data sync
```

## Module Breakdown

### 1. Accounts & Stores
- Shopify OAuth install flow bootstraps the **Account** and **Store** records; support multi-store linking per owner.
- Team management (Owner/Finance/Marketing) stored via `TeamMember` table with role-based gates in frontend.
- Subscriptions handled with Shopify Billing API: Basic vs. Pro plans + usage-based overages (orders/store count). Trial flag stored on `Subscription`.

### 2. Data Sources
- **Shopify**: Webhooks (orders/create, orders/updated, refunds, fulfillments) push deltas; nightly backfill job to ensure completeness. Normalized entities: `Order`, `OrderLine`, `Transaction`, `ShippingLine`, `Discount`.
- **Ads**: Only Meta Ads is supported in V1. OAuth tokens live in `AdAccountCredential` and workers fetch spend/conversion totals per day.
- **Payments**: Shopify Payments via Admin REST + payouts API; PayPal via native REST. Fee data is persisted per transaction for reconciliation.

The codebase now includes a sync framework:
- `AdSpendRecord`, `PaymentPayout`, `SyncJob` tables capture normalized data and job telemetry.
- Connectors (`app/services/sync/*.server.js`) orchestrate provider-specific fetchers, persist aggregates, and update `DailyMetric`.
- Settings UI exposes manual "Sync now" actions per provider until background schedulers are wired up.
- **COGS Inputs**: CSV uploads or demo seeds populate `SkuCost`. Variable cost templates cover payment/platform fees.
- **Exchange Rates**: Daily fetch from the bundled FX provider with manual override per merchant.

### 3. Cost Configuration
- SKU/variant level cost table with effective date ranges and CSV import.
- Variable cost templates applied per order (payment fees, platform commissions).

### 4. Profit Engine
- Order pipeline calculates: revenue, direct costs (COGS, shipping, payment, platform), allocated ad spend, resulting gross/net profit & margin.
- Attribution adapter: default last-touch from ad platform; plug-in interface for custom windows or weighted splits.
- Aggregations persisted in `MetricDaily` for quick dashboard queries (by date, store, channel, product). Additional dims (geo, customer) stored as needed.
- Multi-currency: store raw values in source currency, convert to master currency using rate snapshot; maintain `MoneyValue` composite fields.

### 5. Reporting & Dashboards
- Home dashboard cards + line/pie charts sourced from pre-aggregated metrics with flexible date filters.
- Order and product profitability tables with filters/sorting.
- Later phases can extend to channel/ad reports, refund analytics, and custom report builders.

### 6. Reconciliation & Alerts
- Automated checks between Shopify orders vs. payment processor payouts, and Shopify vs. Meta-reported conversions. Diff records stored for UI (`ReconciliationIssue`).
- Current build runs payout/ad conversion detectors on-demand (and eventually via cron) to populate issues shown in `/app/reconciliation`.
- Alerting/notification pipelines are deferred to later phases; V1 focuses on surfaced lists inside the app.

### 7. Onboarding & Help
- Post-install wizard drives store connection, Meta Ads auth, COGS import, and currency/exchange selection.
- When data is still syncing, a mock dashboard is shown so merchants understand expected output.
- Tooltips reference formula definitions; embedded FAQ/help center page for troubleshooting plus Privacy/Terms routes.

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
   - Core dashboard plus order & product profit tables; Shopify vs. payments & Meta reconciliation UI.
2. **Phase 2 - Advanced**
   - Additional ad networks, proactive notifications, scheduled digest emails/webhooks, fixed cost allocation, richer refund analysis.
3. **Phase 3 - Premium**
   - Logistics provider integrations, advanced anomaly detection, accounting software sync, drag-and-drop custom reporting, multi-language UX.

This architecture doc anchors implementation priorities and ensures new modules map cleanly onto the data model and worker topology as we begin coding Phase 1.

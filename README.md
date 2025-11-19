# Profit Pulse

Profit Pulse is a profitability co-pilot for Shopify merchants. It ingests multi-store commerce data, enriches it with cost and attribution models, and surfaces real-time contribution margins so finance and operations teams can reconcile performance without spreadsheets.

## V1 scope

- **Who we serve** – Small and mid-sized Shopify brands that rely on paid social (Meta) and just want trustworthy profit + reconciliation.
- **What V1 promises**  
  1. Surface real net profit for the last 30–60 days (order & SKU level) with minimal configuration.  
  2. Flag obvious Shopify ↔ Payments / Shopify ↔ Ads mismatches.  
  3. Keep setup simple: OAuth, connect Meta, upload COGS, set currency, done.
- **Intentionally out of scope for launch** – LTV/cohort views, complex accounting charts, advanced fixed-cost allocation, ERP/logistics integrations, additional ad networks, and full-blown team management. We call these out explicitly so expectations stay aligned.
- **Launch-day integrations** – Shopify orders + payouts, Meta Ads spend, manual COGS uploads, and the reconciliation workspace are the only production-ready connectors. Logistics providers, ERP cost sync, and fixed-cost allocators remain disabled behind feature flags until we have enough coverage for GA.
- **Language** – The UI is English-first with an experimental Chinese copy toggle for onboarding/help; we do not advertise multi-language support until feedback validates it.

## Key capabilities

- **Shopify ingestion** – OAuth install flows sync Shopify orders, line items, refunds, shipping, taxes, and payouts. New installs backfill 60 days of orders and continue on a 10–15 minute cadence with webhooks for near real time updates.
- **Meta Ads integration** – Merchants connect a single Meta Ads account to bring in daily spend, clicks, and attributed conversions. Matching order IDs are attributed automatically; duplicates are averaged across rows per the V1 spec.
- **Cost templates & COGS** – Upload CSV files or seed demo data to maintain SKU/variant costs. Payment fee templates cover Shopify Payments and PayPal, and a global platform fee handles marketplace commissions.
- **Profit engine & currency** – Every order is revalued into the workspace currency using live FX rates (with manual overrides). Net revenue, direct costs, advertising spend, and net profit roll up into daily metrics and time-series dashboards.
- **Dashboards & reports** – Merchants get a single-page dashboard with metric cards, trends, cost composition, and top SKU tables plus dedicated order and product profit tables with filters and sorting.
- **Reconciliation** – Daily summaries compare Shopify vs. payment gateways and Shopify vs. Meta conversions to highlight variances above configurable thresholds.
- **Shopify Billing** – Basic (single store, 1,000 orders) and Pro (multi-store, higher limits) plans with a shared 14-day trial. Usage monitoring pauses ingestion when limits are hit.

## Architecture overview

| Layer | Tech | Notes |
| --- | --- | --- |
| UI | Remix + Polaris | The front-end shell originates from Shopify’s Remix template, with custom routes under `/app/routes/app*.jsx` for the merchant console. |
| Services | Node/TypeScript modules | Domain logic for profits, plan limits, Shopify + Meta sync, reconciliation, and billing lives in `/app/services`. |
| Persistence | Prisma + PostgreSQL | Schema stored in `prisma/schema.prisma`; migrations ensure quota and cost integrity. |
| Background work | Scripts & scheduled runners | Sync jobs under `/app/services/sync` power Shopify orders, Meta Ads, and Shopify Payments/PayPal payout refreshes. |

The `app` directory retains Shopify’s Vite build tooling and auth scaffolding, while services/tests/documentation are bespoke for Profit Pulse.

## Getting started

### Prerequisites

- Node.js 18+
- npm (ships with Node) or another compatible package manager
- A Shopify Partner account with a development store for installation
- A PostgreSQL database (local or hosted)

### Install dependencies

```bash
npm install
```

### Configure environment

Copy `.env.example` to `.env` and populate the required fields. At minimum you must provide:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL`
- `SCOPES`
- `DATABASE_URL`
- `CREDENTIAL_ENCRYPTION_KEY`

Profit Pulse validates these on boot and points to [ENVIRONMENT.md](ENVIRONMENT.md) when anything is missing. Consult that document for optional knobs (Meta Ads, PayPal payouts, caching).

### Database migrations

```bash
npx prisma migrate deploy
```

To seed demo cost templates and sample data for local exploration, use the actions inside the Settings page ("Import demo cost configuration" / "Process demo order").

### Run the app locally

```bash
npm run dev
```

The development server relies on the Shopify CLI tunnel. Press `p` in the CLI output to open the embedded app after authenticating with your development store.

### Project structure primer

- `app/routes/*` – Remix route modules. Files prefixed with `app.` extend Shopify’s admin template, while `auth.*` and `webhooks.*` handle OAuth and platform callbacks.
- `app/services/*` – Profit Pulse domain services (profit engine, daily metrics, plan limits, Meta Ads + payout sync, reconciliation).
- `app/utils/*` – Shared utilities including logging, caching, metrics, and environment validation.
- `prisma/` – Database schema and migrations. Seed scripts inject demo costs and metrics for new stores.
- `tests/` – Node test suites covering the profit engine, plan limits, and credential refresh routines.

## Testing

Domain-heavy modules (profit engine, plan limits, reporting) are designed for integration testing. Add tests under `tests/` and run them with:

```bash
npm test
```

(Tests are not bundled yet; contributions adding critical-path coverage are welcome.)

## Security hardening highlights

- Sensitive API credentials (Meta Ads, PayPal) are encrypted with `CREDENTIAL_ENCRYPTION_KEY` before persistence.
- Plan limit enforcement locks monthly usage rows with `FOR UPDATE` semantics to prevent double counting under concurrency.
- Webhook handlers validate Shopify HMAC headers and bail fast when mandatory scopes or shop domains are missing.

## Caching and scale-out

- The default cache backend is in-process for simplicity. Set both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to enable a shared Upstash Redis cache accessed via HTTPS, which keeps memoized FX rates and dashboard aggregates coherent across instances.
- When no external backend is configured, memoized functions remain safe to call—they simply recompute results per instance.

## Contributing

Issues and pull requests that improve observability, add integration coverage, or expand automated tests are appreciated. Please:

1. Open an issue describing the change and motivation.
2. Fork the repository and create a feature branch.
3. Add tests or documentation for new behavior.
4. Run `npm run lint` and `npm test` before submitting your PR.

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE) for details.

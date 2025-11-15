# Profit Pulse

Profit Pulse is a profitability co-pilot for Shopify merchants. It ingests multi-store commerce data, enriches it with cost and attribution models, and surfaces real-time contribution margins so finance and operations teams can reconcile performance without spreadsheets.

## Key capabilities

- **Order & payout ingestion** – Sync Shopify orders, settlements, logistics data, and third-party ad spend into a unified workspace with currency/timezone normalization.
- **Profit engine** – Decompose revenue, COGS, shipping, payment, platform, and custom costs per order and aggregate daily KPIs for dashboards and profit/loss statements.
- **Advertising attribution** – Join paid media data (Google Ads, Meta, Bing, TikTok) to order cohorts to quantify blended ROAS and POAS.
- **Alerts & notifications** – Dispatch Slack/Teams/Zapier/Make alerts when margins degrade, refunds spike, or attribution rules detect anomalies.
- **Report scheduling** – Email or webhook recurring digests with calendar-aware frequencies and strict webhook allowlisting to prevent SSRF (extendable via `WEBHOOK_HOST_ALLOWLIST`).
- **Plan enforcement & overages** – Track monthly order usage, pause ingestion when limits are hit, and bill overage charges safely inside transactions.

## Architecture overview

| Layer | Tech | Notes |
| --- | --- | --- |
| UI | Remix + Polaris | The front-end shell originates from Shopify’s Remix template, with custom routes under `/app/routes/app*.jsx` for the merchant console. |
| Services | Node/TypeScript modules | Domain logic for profits, plan limits, reporting, alerts, and integrations lives in `/app/services` (custom to Profit Pulse). |
| Persistence | Prisma + PostgreSQL | Schema stored in `prisma/schema.prisma`; migrations ensure quota and cost integrity. |
| Background work | Scripts & scheduled runners | Report schedule runner (`app/services/report-schedules-runner.server.js`) and sync jobs in `/scripts` extend the template for long-running tasks. |

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

Profit Pulse validates these on boot and points to [ENVIRONMENT.md](ENVIRONMENT.md) when anything is missing. Consult that document for optional knobs (ads, payments, accounting, Upstash cache, etc.).

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
- `app/services/*` – Profit Pulse domain services (profit engine, reporting, plan limits, notifications, sync jobs).
- `app/utils/*` – Shared utilities including logging, caching, metrics, and environment validation.
- `prisma/` – Database schema and migrations. Seed scripts inject demo costs and metrics for new stores.
- `tests/` – Node test suites covering the profit engine, plan limits, notifications, scheduling, and integrations.

## Testing

Domain-heavy modules (profit engine, plan limits, reporting) are designed for integration testing. Add tests under `tests/` and run them with:

```bash
npm test
```

(Tests are not bundled yet; contributions adding critical-path coverage are welcome.)

## Security hardening highlights

- Report schedule webhooks, notification channels, and test dispatches are restricted to HTTPS endpoints on vetted hosts (Slack, Teams, Zapier, Make) plus allowlisted overrides.
- Sensitive API credentials are encrypted with `CREDENTIAL_ENCRYPTION_KEY` before persistence.
- Plan limit enforcement locks monthly usage rows with `FOR UPDATE` semantics to prevent double counting under concurrency.

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

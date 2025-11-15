# Profit Pulse

Profit Pulse is a production-ready Shopify SaaS that ingests multi-store commerce data, enriches it with cost models, and surfaces real-time profitability insights. It focuses on giving finance and operations teams a reliable picture of contribution margin across channels while enforcing plan limits and sending proactive alerts.

## Key capabilities

- **Multi-store commerce ingestion** – Sync Shopify orders, payouts, logistics, and ad spend into a unified merchant workspace with currency/timezone normalization.
- **Profit engine** – Decompose revenue, COGS, shipping, payment, platform, and custom costs per order and aggregate daily KPIs for dashboards and reports.
- **Alerts & notifications** – Dispatch Slack/Teams/Zapier/Make alerts when margins degrade, refunds spike, or attribution rules detect anomalies.
- **Report scheduling** – Email or webhook recurring digests with calendar-aware frequencies and strict webhook allowlisting to prevent SSRF.
- **Plan enforcement & overages** – Track monthly order usage, pause ingestion when limits are hit, and bill overage charges safely inside transactions.
- **Internationalization** – Ship with English and Simplified Chinese UI text, including dashboards, alerts, and plan messaging.

## Architecture overview

| Layer | Tech | Notes |
| --- | --- | --- |
| UI | React Router + Polaris | Client-side routes under `/app/routes` with localized copy helpers. |
| Services | Node/TypeScript modules | Domain logic for profits, plan limits, reporting, alerts, and integrations (`/app/services`). |
| Persistence | Prisma + PostgreSQL | Schema lives in `prisma/schema.prisma`; transactions enforce quota and cost integrity. |
| Background work | Scripts & scheduled runners | Report schedule runner (`app/services/report-schedules-runner.server.js`) and sync scripts under `/scripts`. |

The `app/services` layer intentionally keeps third-party SDK logic isolated from React routes so business rules can be reused in background scripts and tested independently.

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

Copy `.env.example` to `.env` and populate the required fields. Profit Pulse validates mandatory variables on boot to avoid silent misconfiguration.

Refer to [docs/environment.md](docs/environment.md) for a complete list of required and optional variables, grouped by integration.

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

## Testing

Domain-heavy modules (profit engine, plan limits, reporting) are designed for integration testing. Add tests under `tests/` and run them with:

```bash
npm test
```

(Tests are not bundled yet; contributions adding critical-path coverage are welcome.)

## Security hardening highlights

- Report schedule webhooks, notification channels, and test dispatches are restricted to HTTPS endpoints on vetted hosts (Slack, Teams, Zapier, Make).
- Sensitive API credentials are encrypted with `CREDENTIAL_ENCRYPTION_KEY` before persistence.
- Plan limit enforcement locks monthly usage rows with `FOR UPDATE` semantics to prevent double counting under concurrency.

## Contributing

Issues and pull requests that improve observability, add integration coverage, or expand automated tests are appreciated. Please:

1. Open an issue describing the change and motivation.
2. Fork the repository and create a feature branch.
3. Add tests or documentation for new behavior.
4. Run `npm run lint` and `npm test` before submitting your PR.

## License

This project is distributed under the MIT License. See [LICENSE](LICENSE) for details.

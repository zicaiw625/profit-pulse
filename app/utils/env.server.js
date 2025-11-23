const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "DATABASE_URL",
  "CREDENTIAL_ENCRYPTION_KEY",
];
const PRODUCTION_ONLY_ENV_VARS = ["OAUTH_STATE_SECRET"];

let validated = false;

export function validateRequiredEnv() {
  if (validated) return;

  const required = [...REQUIRED_ENV_VARS];
  if (process.env.NODE_ENV === "production") {
    required.push(...PRODUCTION_ONLY_ENV_VARS);
  }

  const missing = required.filter((key) => {
    const value = process.env[key];
    return typeof value !== "string" || value.trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(
        ", ",
      )}. Refer to ENVIRONMENT.md for setup instructions. In production, set OAUTH_STATE_SECRET explicitly instead of relying on fallbacks.`,
    );
  }

  if (process.env.NODE_ENV === "production") {
    maybeWarnOptionalProdVars();
  }

  validated = true;
}

export { REQUIRED_ENV_VARS, PRODUCTION_ONLY_ENV_VARS };

function maybeWarnOptionalProdVars() {
  const hasUpstash =
    typeof process.env.UPSTASH_REDIS_REST_URL === "string" &&
    process.env.UPSTASH_REDIS_REST_URL.trim() !== "" &&
    typeof process.env.UPSTASH_REDIS_REST_TOKEN === "string" &&
    process.env.UPSTASH_REDIS_REST_TOKEN.trim() !== "";
  if (!hasUpstash) {
    // Multi-instance deployments should share cache state; warn loudly if Redis is not configured.
    // eslint-disable-next-line no-console
    console.warn(
      "[env] UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are not set. Configure a shared cache before scaling horizontally.",
    );
  }

  if (
    process.env.PLAN_OVERAGE_ALERT_RECIPIENTS &&
    !process.env.PROFIT_PULSE_EMAIL_ENDPOINT
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      "[env] PLAN_OVERAGE_ALERT_RECIPIENTS configured without PROFIT_PULSE_EMAIL_ENDPOINT; overage alerts will only be logged locally.",
    );
  }
}

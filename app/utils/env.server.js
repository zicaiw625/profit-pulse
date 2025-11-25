const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
];
const PRODUCTION_ONLY_ENV_VARS = [
  "OAUTH_STATE_SECRET",
  "DATABASE_URL",
  "CREDENTIAL_ENCRYPTION_KEY",
];

const DEV_FALLBACKS = {
  SHOPIFY_API_KEY: "dev-shopify-api-key",
  SHOPIFY_API_SECRET: "dev-shopify-api-secret",
  SHOPIFY_APP_URL: "http://localhost",
  SCOPES: "read_orders,read_customers,read_products,read_inventory",
};

let validated = false;
const devFallbacksUsed = new Set();

export function getRuntimeEnvironment() {
  return (process.env.APP_ENV || process.env.NODE_ENV || "development").toLowerCase();
}

export function isProductionEnv() {
  return getRuntimeEnvironment() === "production";
}

function hasValue(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function getEnvVar(key, options = {}) {
  const { optional = false, devFallback = DEV_FALLBACKS[key] } = options;
  const raw = process.env[key];
  if (hasValue(raw)) {
    return raw.trim();
  }

  if (!isProductionEnv() && devFallback) {
    if (!devFallbacksUsed.has(key)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[env] Using development fallback for ${key}. Set the variable locally to silence this warning.`,
      );
      devFallbacksUsed.add(key);
    }
    if (!hasValue(process.env[key])) {
      process.env[key] = devFallback;
    }
    return devFallback;
  }

  if (optional) {
    return undefined;
  }

  throw new Error(
    `Missing required environment variable: ${key}. Runtime environment: ${getRuntimeEnvironment()}. See ENVIRONMENT.md for setup instructions.`,
  );
}

export function validateRequiredEnv() {
  if (validated) return;

  const missing = [];
  REQUIRED_ENV_VARS.forEach((key) => {
    try {
      getEnvVar(key);
    } catch (error) {
      missing.push(key);
    }
  });

  if (isProductionEnv()) {
    PRODUCTION_ONLY_ENV_VARS.forEach((key) => {
      if (!hasValue(process.env[key])) {
        missing.push(key);
      }
    });
  }

  if (missing.length > 0) {
    const unique = Array.from(new Set(missing));
    throw new Error(
      `Missing required environment variables: ${unique.join(
        ", ",
      )}.`,
    );
  }

  if (isProductionEnv()) {
    maybeWarnOptionalProdVars();
  }

  validated = true;
}

export { REQUIRED_ENV_VARS, PRODUCTION_ONLY_ENV_VARS };

function maybeWarnOptionalProdVars() {
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

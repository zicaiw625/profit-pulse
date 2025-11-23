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

  validated = true;
}

export { REQUIRED_ENV_VARS, PRODUCTION_ONLY_ENV_VARS };

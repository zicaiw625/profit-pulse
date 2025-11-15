const REQUIRED_ENV_VARS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_APP_URL",
  "SCOPES",
  "DATABASE_URL",
  "CREDENTIAL_ENCRYPTION_KEY",
];

let validated = false;

export function validateRequiredEnv() {
  if (validated) return;

  const missing = REQUIRED_ENV_VARS.filter((key) => {
    const value = process.env[key];
    return typeof value !== "string" || value.trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(
        ", ",
      )}. Refer to ENVIRONMENT.md for setup instructions.`,
    );
  }

  validated = true;
}

export { REQUIRED_ENV_VARS };

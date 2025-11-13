import crypto from "node:crypto";

const BASE_SECURITY_HEADERS = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function buildContentSecurityPolicy(cspNonce) {
  if (!cspNonce) {
    throw new Error("CSP nonce is required to build the Content-Security-Policy header.");
  }
  const directives = {
    "default-src": ["'self'", "https:", "data:"],
    "script-src": ["'self'", "https://cdn.shopify.com", `'nonce-${cspNonce}'`],
    "style-src": ["'self'", "'unsafe-inline'", "https://cdn.shopify.com"],
    "img-src": ["'self'", "data:", "https://cdn.shopify.com"],
    "font-src": ["'self'", "https://cdn.shopify.com"],
    "connect-src": ["'self'", "https://cdn.shopify.com", "https://admin.shopify.com"],
    "frame-ancestors": ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}

export function applySecurityHeaders(headers, { cspNonce } = {}) {
  const policy = buildContentSecurityPolicy(cspNonce);
  if (!headers.has("Content-Security-Policy")) {
    headers.set("Content-Security-Policy", policy);
  }
  Object.entries(BASE_SECURITY_HEADERS).forEach(([name, value]) => {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  });
}

const CREDENTIAL_SECRET_PREFIX = "enc.v1:";
let cachedCredentialKey = null;

function getCredentialKey() {
  if (cachedCredentialKey) {
    return cachedCredentialKey;
  }
  const secret = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY is required to encrypt sensitive credentials",
    );
  }
  cachedCredentialKey = crypto.createHash("sha256").update(secret).digest();
  return cachedCredentialKey;
}

export function encryptSensitiveString(value) {
  if (!value) return value;
  const key = getCredentialKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]).toString("base64");
  return `${CREDENTIAL_SECRET_PREFIX}${payload}`;
}

export function decryptSensitiveString(value) {
  if (!value) return value;
  if (!value.startsWith(CREDENTIAL_SECRET_PREFIX)) {
    return value;
  }
  const base64 = value.slice(CREDENTIAL_SECRET_PREFIX.length);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length <= 28) {
    throw new Error("Encrypted credential payload malformed");
  }
  const iv = buffer.subarray(0, 12);
  const authTag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const key = getCredentialKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

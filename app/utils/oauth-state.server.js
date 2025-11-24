import crypto from "node:crypto";
import { getEnvVar, isProductionEnv } from "./env.server.js";

// Dev-only fallback; production runs are guarded by validateRequiredEnv to force a real secret.
const DEFAULT_SECRET = "development-oauth-state-secret";

function getStateSecret() {
  const devFallback =
    isProductionEnv() === false
      ? process.env.SHOPIFY_API_SECRET || DEFAULT_SECRET
      : undefined;
  return getEnvVar("OAUTH_STATE_SECRET", {
    optional: !isProductionEnv(),
    devFallback,
  });
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const normalized = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

export function createSignedState(payload) {
  const secret = getStateSecret();
  const serialized = JSON.stringify(payload ?? {});
  const payloadSegment = base64UrlEncode(serialized);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payloadSegment)
    .digest();
  const signatureSegment = base64UrlEncode(signature);
  return `${payloadSegment}.${signatureSegment}`;
}

export function parseSignedState(token) {
  if (!token) {
    throw new Error("Missing OAuth state token");
  }
  const secret = getStateSecret();
  const [payloadSegment, signatureSegment] = token.split(".");
  if (!payloadSegment || !signatureSegment) {
    throw new Error("Invalid OAuth state token");
  }
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payloadSegment)
    .digest();
  const receivedSignature = base64UrlDecode(signatureSegment);
  if (expectedSignature.length !== receivedSignature.length) {
    throw new Error("OAuth state signature mismatch");
  }
  if (!crypto.timingSafeEqual(expectedSignature, receivedSignature)) {
    throw new Error("OAuth state signature mismatch");
  }
  const payloadBuffer = base64UrlDecode(payloadSegment);
  try {
    return JSON.parse(payloadBuffer.toString("utf8"));
  } catch (error) {
    throw new Error("Invalid OAuth state payload");
  }
}

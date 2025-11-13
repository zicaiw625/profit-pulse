import crypto from "node:crypto";

export function generateCspNonce() {
  return crypto.randomBytes(16).toString("base64");
}

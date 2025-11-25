import crypto from "crypto";
import pkg from "@prisma/client";
import { authenticate } from "../shopify.server";
import { queueCustomerPrivacyRequest } from "../services/privacy.server";
import { getEnvVar } from "../utils/env.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const { GdprRequestType } = pkg;
const webhookLogger = createScopedLogger({ route: "webhooks.customers.redact" });
const SHOPIFY_API_SECRET = getEnvVar("SHOPIFY_API_SECRET");

function extractCustomerEmail(payload) {
  if (!payload) return null;
  if (payload.customer?.email) return payload.customer.email;
  if (Array.isArray(payload.customers) && payload.customers.length > 0) {
    return payload.customers.find((item) => item?.email)?.email ?? null;
  }
  if (payload.email) return payload.email;
  return null;
}

function verifyWebhookHmac(request, rawBody) {
  const headerHmac = request.headers.get("x-shopify-hmac-sha256") || "";
  if (!headerHmac) return false;

  const generatedHmac = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    const headerBuf = Buffer.from(headerHmac, "base64");
    const generatedBuf = Buffer.from(generatedHmac, "base64");
    if (headerBuf.length !== generatedBuf.length) return false;
    return crypto.timingSafeEqual(headerBuf, generatedBuf);
  } catch {
    return false;
  }
}

export const action = async ({ request }) => {
  const cloned = request.clone();
  const rawBody = await cloned.text();

  if (!verifyWebhookHmac(request, rawBody)) {
    webhookLogger.warn("invalid_hmac", {
      topic: "customers/redact",
      shop: request.headers.get("x-shopify-shop-domain") || "unknown",
    });
    return new Response("Invalid webhook signature", { status: 401 });
  }

  const { shop, payload, topic } = await authenticate.webhook(request);
  webhookLogger.info("webhook_received", { topic, shop });

  try {
    const email = extractCustomerEmail(payload);
    if (!email) {
      webhookLogger.warn("gdpr_redact_missing_email", { shop, topic });
      return new Response();
    }

    await queueCustomerPrivacyRequest({
      shopDomain: shop,
      type: GdprRequestType.DELETE,
      subjectEmail: email,
      notes: "Queued from Shopify customers/redact webhook",
    });
  } catch (error) {
    webhookLogger.error("gdpr_redact_enqueue_failed", {
      shop,
      topic,
      error: serializeError(error),
    });
  }

  return new Response();
};

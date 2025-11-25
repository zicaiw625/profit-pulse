import crypto from "crypto";
import pkg from "@prisma/client";
import { authenticate } from "../shopify.server";
import { queueCustomerPrivacyRequest } from "../services/privacy.server";
import { getEnvVar } from "../utils/env.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const { GdprRequestType } = pkg;
const webhookLogger = createScopedLogger({ route: "webhooks.customers.data_request" });
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
  // 先拿原始 body 做 HMAC 校验
  const cloned = request.clone();
  const rawBody = await cloned.text();

  if (!verifyWebhookHmac(request, rawBody)) {
    webhookLogger.warn("invalid_hmac", {
      topic: "customers/data_request",
      shop: request.headers.get("x-shopify-shop-domain") || "unknown",
    });
    // ❗ 不合法必须返回 401，Shopify 自动检查就看这个
    return new Response("Invalid webhook signature", { status: 401 });
  }

  // 通过再交给 Shopify SDK 做进一步认证和解析
  const { shop, payload, topic } = await authenticate.webhook(request);
  webhookLogger.info("webhook_received", { topic, shop });

  try {
    const email = extractCustomerEmail(payload);
    if (!email) {
      webhookLogger.warn("gdpr_request_missing_email", { shop, topic });
      return new Response();
    }

    await queueCustomerPrivacyRequest({
      shopDomain: shop,
      type: GdprRequestType.EXPORT,
      subjectEmail: email,
      notes: "Queued from Shopify customers/data_request webhook",
    });
  } catch (error) {
    webhookLogger.error("gdpr_data_request_enqueue_failed", {
      shop,
      topic,
      error: serializeError(error),
    });
  }

  // 合法请求返回 200 系列即可
  return new Response();
};

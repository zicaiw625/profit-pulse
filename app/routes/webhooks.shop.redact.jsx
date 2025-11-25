import crypto from "crypto";
import { authenticate } from "../shopify.server";
import { queueShopRedactionRequest } from "../services/privacy.server";
import { getEnvVar } from "../utils/env.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({ route: "webhooks.shop.redact" });
const SHOPIFY_API_SECRET = getEnvVar("SHOPIFY_API_SECRET");

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
      topic: "shop/redact",
      shop: request.headers.get("x-shopify-shop-domain") || "unknown",
    });
    return new Response("Invalid webhook signature", { status: 401 });
  }

  const { shop, topic } = await authenticate.webhook(request);
  webhookLogger.info("webhook_received", { topic, shop });

  try {
    await queueShopRedactionRequest({ shopDomain: shop });
  } catch (error) {
    webhookLogger.error("shop_redaction_enqueue_failed", {
      shop,
      topic,
      error: serializeError(error),
    });
  }

  return new Response();
};

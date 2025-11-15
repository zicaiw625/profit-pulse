import { authenticate } from "../shopify.server";
import { queueShopRedactionRequest } from "../services/privacy.server";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({ route: "webhooks.shop.redact" });

export const action = async ({ request }) => {
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

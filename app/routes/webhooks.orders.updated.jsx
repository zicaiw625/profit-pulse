import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { processShopifyOrder } from "../services/profit-engine.server";
import { createScopedLogger } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({ route: "webhooks.orders.updated" });

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  webhookLogger.info("webhook_received", { topic, shop });

  const store = await ensureMerchantAndStore(shop);
  await processShopifyOrder({ store, payload });

  return new Response();
};

import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { syncOrderById } from "../services/sync/shopify-orders.server";
import { createScopedLogger } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({ route: "webhooks.refunds.create" });

export const action = async ({ request }) => {
  const { shop, payload, session, topic } = await authenticate.webhook(request);
  webhookLogger.info("webhook_received", { topic, shop });

  const store = await ensureMerchantAndStore(shop);
  if (!payload?.order_id) {
    webhookLogger.warn("refund_missing_order_id", {
      shop,
      topic,
      refundId: payload?.id,
    });
    return new Response();
  }

  await syncOrderById({ store, session, orderId: payload.order_id });

  return new Response();
};

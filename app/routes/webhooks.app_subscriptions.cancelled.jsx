import { authenticate } from "../shopify.server";
import { applySubscriptionWebhook } from "../services/billing.server";
import { createScopedLogger } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({
  route: "webhooks.app_subscriptions.cancelled",
});

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  webhookLogger.info("webhook_received", { topic, shop });

  await applySubscriptionWebhook({
    shopDomain: shop,
    payload: {
      ...payload,
      status: payload?.status ?? "CANCELLED",
    },
  });

  return new Response();
};

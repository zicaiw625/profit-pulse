import { authenticate } from "../shopify.server";
import db from "../db.server";
import { createScopedLogger } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({ route: "webhooks.app.uninstalled" });

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  webhookLogger.info("webhook_received", { topic, shop });

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};

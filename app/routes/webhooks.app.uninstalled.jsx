import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  UNINSTALL_RETENTION_DAYS,
  UNINSTALL_RETENTION_WINDOW_MS,
} from "../constants/retention.js";
import { markStoreDisconnected } from "../services/retention.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({ route: "webhooks.app.uninstalled" });

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  webhookLogger.info("webhook_received", { topic, shop });

  await db.session.deleteMany({ where: { shop } });

  try {
    const store = await markStoreDisconnected({ shopDomain: shop });
    if (store) {
      const deleteAfter = new Date(
        store.disconnectedAt.getTime() + UNINSTALL_RETENTION_WINDOW_MS,
      ).toISOString();
      webhookLogger.info("store_marked_disconnected", {
        shop,
        storeId: store.id,
        deleteAfter,
      });
    } else {
      webhookLogger.warn("store_not_found_for_uninstall", { shop });
    }
  } catch (error) {
    webhookLogger.error("uninstall_cleanup_schedule_failed", {
      shop,
      topic,
      error: serializeError(error),
    });
  }

  return new Response();
};

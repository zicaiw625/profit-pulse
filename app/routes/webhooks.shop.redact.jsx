import db from "../db.server";
import { authenticate } from "../shopify.server";
import { hardDeleteStoreData } from "../services/privacy.server";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({ route: "webhooks.shop.redact" });

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  webhookLogger.info("webhook_received", { topic, shop });

  try {
    const store = await db.store.findUnique({
      where: { shopDomain: shop },
      select: { id: true },
    });

    if (!store) {
      webhookLogger.warn("shop_redaction_store_missing", { shop, topic });
      return new Response();
    }

    const result = await hardDeleteStoreData(store.id);

    if (result?.deleted) {
      webhookLogger.info("shop_redaction_completed", {
        shop,
        topic,
        storeId: store.id,
        stats: result.stats,
      });
    } else {
      webhookLogger.warn("shop_redaction_noop", {
        shop,
        topic,
        storeId: store.id,
        reason: result?.reason ?? "unknown",
      });
    }
  } catch (error) {
    webhookLogger.error("shop_redaction_failed", {
      shop,
      topic,
      error: serializeError(error),
    });
  }

  return new Response();
};

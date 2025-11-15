import { authenticate } from "../shopify.server";
import db from "../db.server";
import { createScopedLogger } from "../utils/logger.server.js";

const webhookLogger = createScopedLogger({ route: "webhooks.app.scopes_update" });

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  webhookLogger.info("webhook_received", { topic, shop });
  const current = payload.current;

  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });
  }

  return new Response();
};

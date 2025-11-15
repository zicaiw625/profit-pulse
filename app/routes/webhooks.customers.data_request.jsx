import pkg from "@prisma/client";
import { authenticate } from "../shopify.server";
import { queueCustomerPrivacyRequest } from "../services/privacy.server";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const { GdprRequestType } = pkg;
const webhookLogger = createScopedLogger({ route: "webhooks.customers.data_request" });

function extractCustomerEmail(payload) {
  if (!payload) return null;
  if (payload.customer?.email) return payload.customer.email;
  if (Array.isArray(payload.customers) && payload.customers.length > 0) {
    return payload.customers.find((item) => item?.email)?.email ?? null;
  }
  if (payload.email) return payload.email;
  return null;
}

export const action = async ({ request }) => {
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

  return new Response();
};

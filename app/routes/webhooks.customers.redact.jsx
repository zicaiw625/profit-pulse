import pkg from "@prisma/client";
import { authenticate } from "../shopify.server";
import { queueCustomerPrivacyRequest } from "../services/privacy.server";

const { GdprRequestType } = pkg;

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
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const email = extractCustomerEmail(payload);
    if (!email) {
      console.warn("GDPR redact webhook missing customer email");
      return new Response();
    }

    await queueCustomerPrivacyRequest({
      shopDomain: shop,
      type: GdprRequestType.DELETE,
      subjectEmail: email,
      notes: "Queued from Shopify customers/redact webhook",
    });
  } catch (error) {
    console.error("Failed to enqueue GDPR redact request", error);
  }

  return new Response();
};

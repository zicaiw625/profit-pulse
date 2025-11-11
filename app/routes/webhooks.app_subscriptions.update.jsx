import { authenticate } from "../shopify.server";
import { applySubscriptionWebhook } from "../services/billing.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await applySubscriptionWebhook({
    shopDomain: shop,
    payload,
  });

  return new Response();
};

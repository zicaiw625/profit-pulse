import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { processShopifyOrder } from "../services/profit-engine.server";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const store = await ensureMerchantAndStore(shop);
  await processShopifyOrder({ store, payload });

  return new Response();
};

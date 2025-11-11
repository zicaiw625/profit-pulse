import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { syncOrderById } from "../services/sync/shopify-orders.server";

export const action = async ({ request }) => {
  const { shop, payload, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const store = await ensureMerchantAndStore(shop);
  if (!payload?.order_id) {
    console.warn("Refund webhook missing order_id", payload?.id);
    return new Response();
  }

  await syncOrderById({ store, session, orderId: payload.order_id });

  return new Response();
};

import { authenticate } from "../shopify.server";
import { queueShopRedactionRequest } from "../services/privacy.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await queueShopRedactionRequest({ shopDomain: shop });
  } catch (error) {
    console.error("Failed to queue shop redaction", error);
  }

  return new Response();
};

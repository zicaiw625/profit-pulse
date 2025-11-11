import prisma from "../../db.server";
import shopify from "../../shopify.server";
import { processShopifyOrder } from "../profit-engine.server";

export async function syncShopifyOrders({ store, session, days = 2 }) {
  if (!store?.id) {
    throw new Error("Store is required to sync Shopify orders");
  }
  if (!session) {
    throw new Error("Shopify admin session is required for order sync");
  }

  const restClient = new shopify.api.clients.Rest({ session });
  const processedAtMin = await determineStartDate(store.id, days);
  let cursor = null;
  let processed = 0;

  do {
    const response = await restClient.get({
      path: "orders.json",
      query: {
        status: "any",
        processed_at_min: processedAtMin.toISOString(),
        order: "processed_at asc",
        fields: ORDER_FIELDS,
        limit: 250,
        page_info: cursor ?? undefined,
      },
    });

    const orders = response.body?.orders ?? [];
    for (const payload of orders) {
      await processShopifyOrder({ store, payload });
      processed += 1;
    }

    cursor = response.pageInfo?.nextPage?.query?.page_info ?? null;
  } while (cursor);

  return { processed, processedAtMin };
}

export async function syncOrderById({ store, session, orderId }) {
  if (!orderId) {
    throw new Error("orderId is required");
  }
  if (!session) {
    throw new Error("Shopify admin session is required");
  }

  const restClient = new shopify.api.clients.Rest({ session });
  const response = await restClient.get({
    path: `orders/${orderId}.json`,
    query: {
      fields: ORDER_FIELDS,
    },
  });

  const order = response.body?.order;
  if (!order) {
    throw new Error(`Order ${orderId} not found while syncing`);
  }

  await processShopifyOrder({ store, payload: order });
  return order;
}

async function determineStartDate(storeId, days) {
  const latestOrder = await prisma.order.findFirst({
    where: { storeId },
    orderBy: { processedAt: "desc" },
  });

  if (!latestOrder) {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - Math.max(days, 14));
    return start;
  }

  const start = new Date(latestOrder.processedAt);
  start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

const ORDER_FIELDS = [
  "id",
  "name",
  "order_number",
  "processed_at",
  "current_total_price",
  "current_subtotal_price",
  "current_total_tax",
  "current_total_discounts",
  "currency",
  "presentment_currency",
  "source_name",
  "gateway",
  "payment_gateway_names",
  "financial_status",
  "subtotal_price",
  "total_price",
  "total_tax",
  "total_discounts",
  "shipping_lines",
  "total_shipping_price_set",
  "line_items",
  "customer",
  "discount_applications",
  "discount_codes",
  "tax_lines",
].join(",");

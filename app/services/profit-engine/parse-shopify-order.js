import { resolveOrderChannel } from "./update-daily-metrics.js";

function sumArray(arr = [], selector = (item) => item) {
  return arr.reduce((sum, item) => sum + toNumber(selector(item)), 0);
}

function toNumber(value) {
  if (!value && value !== 0) return 0;
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export async function parseShopifyOrder({
  store,
  payload,
  getActiveSkuCostMap,
}) {
  const orderDate = new Date(
    payload.processed_at ||
      payload.closed_at ||
      payload.created_at ||
      payload.updated_at ||
      Date.now(),
  );
  const currency = payload.currency || store.currency || "USD";
  const sourceName = payload.source_name ?? "online";
  const channelKey = resolveOrderChannel(sourceName);

  const subtotalIncludesDiscount =
    payload.current_subtotal_price != null ||
    payload.current_subtotal_price_set?.shop_money?.amount != null;
  const subtotal = toNumber(
    subtotalIncludesDiscount
      ? payload.current_subtotal_price ??
          payload.current_subtotal_price_set?.shop_money?.amount ??
          0
      : payload.subtotal_price ??
          payload.subtotal_price_set?.shop_money?.amount ??
          0,
  );

  const shippingLines = payload.shipping_lines ?? [];
  const shippingRevenue = sumArray(shippingLines, (line) => toNumber(line.price));
  const tax = toNumber(payload.current_total_tax ?? payload.total_tax ?? 0);
  const discount = toNumber(
    payload.current_total_discounts ?? payload.total_discounts ?? 0,
  );
  const total = toNumber(payload.current_total_price ?? payload.total_price ?? 0);
  const customerCountry =
    payload.customer?.default_address?.country_code ?? undefined;
  const paymentGateway = payload.gateway ?? payload.payment_gateway_names?.[0];

  const lineItems = payload.line_items ?? [];
  const skuCostMap = await getActiveSkuCostMap(store.id, orderDate);
  let missingSkuCostCount = 0;
  const lineRecords = lineItems.map((line) => {
    const quantity = line.quantity ?? 0;
    const price = toNumber(line.price ?? line.price_set?.shop_money?.amount ?? 0);
    const lineDiscount = toNumber(line.total_discount ?? 0);
    const revenue = price * quantity - lineDiscount;
    const sku = line.sku ?? undefined;
    const unitCost = sku ? skuCostMap.get(sku) ?? 0 : 0;
    const cogs = unitCost * quantity;
    if (sku && unitCost === 0) {
      missingSkuCostCount += 1;
    }

    return {
      productId: line.product_id ? String(line.product_id) : null,
      variantId: line.variant_id ? String(line.variant_id) : null,
      sku,
      title: line.title ?? "",
      quantity,
      price,
      discount: lineDiscount,
      revenue,
      cogs,
    };
  });

  const totalUnits = lineRecords.reduce((sum, line) => sum + line.quantity, 0);
  const cogsTotal = lineRecords.reduce((sum, line) => sum + line.cogs, 0);
  const revenue =
    subtotal -
    (subtotalIncludesDiscount ? 0 : discount) +
    shippingRevenue +
    tax;

  return {
    orderDate,
    currency,
    subtotal,
    shippingRevenue,
    tax,
    discount,
    total,
    customerCountry,
    paymentGateway,
    lineRecords,
    totalUnits,
    cogsTotal,
    revenue,
    sourceName,
    channelKey,
    missingSkuCostCount,
  };
}

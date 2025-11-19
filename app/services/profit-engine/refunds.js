function toNumber(value) {
  if (!value && value !== 0) return 0;
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function extractRefunds(payload, fallbackCurrency = "USD") {
  const refunds = payload.refunds ?? [];
  return refunds
    .map((refund) => {
      if (!refund?.id) return null;
      const transactions = refund.transactions ?? [];
      const transactionTotal = transactions.reduce((sum, txn) => {
        const amount = toNumber(txn.amount);
        // Shopify sends negative amounts for refunds; convert to positive.
        return sum + Math.abs(amount);
      }, 0);

      const amount =
        transactionTotal || toNumber(refund.total_set?.shop_money?.amount);
      if (!amount) {
        return null;
      }

      return {
        id: String(refund.id),
        processedAt: refund.processed_at
          ? new Date(refund.processed_at)
          : new Date(payload.processed_at || Date.now()),
        amount,
        currency:
          refund.currency || transactions[0]?.currency || fallbackCurrency,
        reason: refund.note || refund.reason || null,
        restock: Boolean(refund.restock),
        lineItems: refund.refund_line_items ?? [],
        transactions,
      };
    })
    .filter(Boolean);
}

export async function syncRefundRecords(
  tx,
  { storeId, orderId, shopifyOrderId, refunds, currency },
) {
  if (!refunds.length) {
    await tx.refundRecord.deleteMany({ where: { orderShopifyId: shopifyOrderId } });
    return { amount: 0, count: 0, bySku: new Map() };
  }

  const refundIds = refunds.map((refund) => refund.id);
  await tx.refundRecord.deleteMany({
    where: {
      orderShopifyId: shopifyOrderId,
      shopifyRefundId: { notIn: refundIds },
    },
  });

  let totalAmount = 0;
  const refundBySku = new Map();

  for (const refund of refunds) {
    totalAmount += refund.amount;
    const skuMap = summarizeRefundLineItems(refund.lineItems);
    for (const [sku, value] of skuMap.entries()) {
      refundBySku.set(sku, (refundBySku.get(sku) ?? 0) + value);
    }

    await tx.refundRecord.upsert({
      where: { shopifyRefundId: refund.id },
      create: {
        storeId,
        orderId,
        orderShopifyId: shopifyOrderId,
        shopifyRefundId: refund.id,
        processedAt: refund.processedAt,
        currency: refund.currency || currency,
        amount: refund.amount,
        reason: refund.reason,
        restock: refund.restock,
      },
      update: {
        processedAt: refund.processedAt,
        currency: refund.currency || currency,
        amount: refund.amount,
        reason: refund.reason,
        restock: refund.restock,
      },
    });
  }

  return {
    amount: totalAmount,
    count: refunds.length,
    bySku: refundBySku,
  };
}

export function summarizeRefundLineItems(lineItems = []) {
  const map = new Map();
  for (const entry of lineItems) {
    const sku = entry?.line_item?.sku ?? entry?.line_item?.variant_id ?? null;
    if (!sku) continue;
    const amount = toNumber(
      entry.subtotal_set?.shop_money?.amount ??
        entry.total_set?.shop_money?.amount ??
        entry.subtotal ??
        entry.amount ??
        0,
    );
    if (amount <= 0) continue;
    map.set(sku, (map.get(sku) ?? 0) + amount);
  }
  return map;
}


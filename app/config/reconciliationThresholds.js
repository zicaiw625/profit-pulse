export const RECONCILIATION_THRESHOLDS = {
  payment: {
    amountDelta: 50, // USD equivalent
    percentDelta: 0.05,
  },
  ads: {
    conversionMultiple: 1.5,
    minSpendWithoutConversions: 200,
  },
};

export function describeRules() {
  const amount = RECONCILIATION_THRESHOLDS.payment.amountDelta;
  const percent = RECONCILIATION_THRESHOLDS.payment.percentDelta * 100;
  const adsMultiple = RECONCILIATION_THRESHOLDS.ads.conversionMultiple;
  const spend = RECONCILIATION_THRESHOLDS.ads.minSpendWithoutConversions;

  return {
    payment: `标记支付异常当日 Shopify 与支付渠道的金额差异超过 ${percent}% 或 ${amount} 本币。`,
    ads: `标记广告异常当某天 Meta 转化量高于 Shopify 订单 ${adsMultiple} 倍，或当日花费超过 ${spend} 但 0 转化。`,
  };
}

export const DEFAULT_PAYMENT_DIFF_THRESHOLD = 50;
export const DEFAULT_PAYMENT_PERCENT_THRESHOLD = 0.05;
export const DEFAULT_AD_CONVERSION_MULTIPLE = 1.5;
export const DEFAULT_AD_SPEND_HIGH = 200;
export const DEFAULT_MIN_ORDERS_FOR_AD_CHECK = 5;

export const RECONCILIATION_RULE_DEFAULTS = {
  payment: {
    amountDelta: DEFAULT_PAYMENT_DIFF_THRESHOLD,
    percentDelta: DEFAULT_PAYMENT_PERCENT_THRESHOLD,
  },
  ads: {
    conversionMultiple: DEFAULT_AD_CONVERSION_MULTIPLE,
    minSpendWithoutConversions: DEFAULT_AD_SPEND_HIGH,
    minOrdersForSpendCheck: DEFAULT_MIN_ORDERS_FOR_AD_CHECK,
  },
};

export function describeReconciliationRules() {
  const paymentAmount = DEFAULT_PAYMENT_DIFF_THRESHOLD;
  const paymentPercent = DEFAULT_PAYMENT_PERCENT_THRESHOLD * 100;
  const adsMultiple = DEFAULT_AD_CONVERSION_MULTIPLE;
  const adsSpend = DEFAULT_AD_SPEND_HIGH;

  return {
    payment: `Shopify payout variance flagged above ${paymentPercent}% or ${paymentAmount} base currency.`,
    ads: `Meta ads flagged when conversions exceed Shopify orders by ${adsMultiple}x or spend above ${adsSpend} with zero conversions.`,
  };
}


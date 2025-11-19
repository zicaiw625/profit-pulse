import { BillingInterval } from "@shopify/shopify-api";
import pkg from "@prisma/client";

const { PlanTier } = pkg;

const CORE_FEATURES = [
  "Shopify OAuth with multi-store support",
  "Realtime profit dashboard",
  "14-day free trial",
  "Shopify ↔︎ payments & ads reconciliation",
  "SKU / CSV cost management",
];

export const PLAN_DEFINITIONS = {
  BASIC: {
    tier: PlanTier.BASIC,
    billingKey: "profit-pulse-basic",
    name: "Basic",
    description:
      "Single store brands validating paid media efficiency with up to 1,000 monthly orders.",
    price: 39,
    currency: "USD",
    interval: BillingInterval.Every30Days,
    intervalLabel: "per month",
    trialDays: 14,
    allowances: {
      stores: 1,
      orders: 1000,
    },
    features: [
      ...CORE_FEATURES,
      "Meta Ads connector",
      "Shopify Payments fees template",
    ],
  },
  PRO: {
    tier: PlanTier.PRO,
    billingKey: "profit-pulse-pro",
    name: "Pro",
    description:
      "Multi-store operators needing higher order volume limits and flexible fee templates.",
    price: 99,
    currency: "USD",
    interval: BillingInterval.Every30Days,
    intervalLabel: "per month",
    trialDays: 14,
    allowances: {
      stores: 5,
      orders: 20000,
    },
    features: [
      ...CORE_FEATURES,
      "Multiple Shopify stores",
      "Higher Meta Ads spend ingestion limits",
      "Priority reconciliation queue",
    ],
  },
};

export const BILLABLE_PLANS = Object.values(PLAN_DEFINITIONS);

export const BILLING_CONFIG = BILLABLE_PLANS.reduce((config, plan) => {
  config[plan.billingKey] = {
    trialDays: plan.trialDays,
    lineItems: [
      {
        amount: plan.price,
        currencyCode: plan.currency,
        interval: plan.interval,
      },
    ],
  };
  return config;
}, {});

export function listPlanOptions() {
  return Object.values(PLAN_DEFINITIONS).map((plan) => ({
    tier: plan.tier,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    intervalLabel: plan.intervalLabel,
    trialDays: plan.trialDays,
    allowances: plan.allowances,
    features: plan.features,
    billingKey: plan.billingKey,
  }));
}

export function findPlanByBillingKey(billingKey) {
  return Object.values(PLAN_DEFINITIONS).find(
    (plan) => plan.billingKey === billingKey,
  );
}

export function findPlanByTier(tier) {
  return Object.values(PLAN_DEFINITIONS).find((plan) => plan.tier === tier);
}

export const DEFAULT_PLAN = PLAN_DEFINITIONS.BASIC;

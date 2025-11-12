import { BillingInterval } from "@shopify/shopify-api";
import pkg from "@prisma/client";

const { PlanTier } = pkg;

const baseFeatures = [
  "Shopify multi-store data sync",
  "Realtime profit engine",
  "Refund & fee reconciliation",
  "Email summaries",
];

export const PLAN_DEFINITIONS = {
  FREE: {
    tier: PlanTier.FREE,
    billingKey: null,
    name: "Free",
    description: "Single store, limited history, perfect for evaluating the platform.",
    price: 0,
    currency: "USD",
    interval: BillingInterval.Every30Days,
    intervalLabel: "per month",
    trialDays: 14,
    allowances: {
      stores: 1,
      orders: 1000,
      adAccounts: 1,
    },
    features: [
      ...baseFeatures,
      "Meta + Google ad connectors",
    ],
  },
  BASIC: {
    tier: PlanTier.BASIC,
    billingKey: "profit-pulse-basic",
    name: "Basic",
    description: "Single store, essential profit analytics & reconciliations.",
    price: 49,
    currency: "USD",
    interval: BillingInterval.Every30Days,
    intervalLabel: "per month",
    trialDays: 14,
    allowances: {
      stores: 1,
      orders: 5000,
      adAccounts: 2,
    },
    features: [
      ...baseFeatures,
      "COGS templates & SKU costs",
      "Meta + Google ad connectors",
    ],
  },
  PRO: {
    tier: PlanTier.PRO,
    billingKey: "profit-pulse-pro",
    name: "Pro",
    description: "Multi-store brands with deeper automation & alerts.",
    price: 129,
    currency: "USD",
    interval: BillingInterval.Every30Days,
    intervalLabel: "per month",
    trialDays: 14,
    allowances: {
      stores: 5,
      orders: 20000,
      adAccounts: 8,
    },
    features: [
      ...baseFeatures,
      "Fixed cost allocation",
      "Slack / Teams alerts",
      "Advanced anomaly detection",
      "Custom exports & API access",
    ],
  },
};

const BILLABLE_PLANS = Object.values(PLAN_DEFINITIONS).filter(
  (plan) => plan.billingKey && plan.price > 0,
);

export const BILLING_CONFIG = BILLABLE_PLANS.reduce(
  (config, plan) => {
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
  },
  {},
);

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

export const DEFAULT_PLAN = PLAN_DEFINITIONS.FREE;

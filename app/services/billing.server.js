import prisma from "../db.server.js";
import {
  PLAN_DEFINITIONS,
  listPlanOptions,
  findPlanByBillingKey,
  findPlanByTier,
  DEFAULT_PLAN,
  BILLABLE_PLANS,
} from "../config/billing.js";
import { createScopedLogger } from "../utils/logger.server.js";

const BILLING_PLAN_KEYS = BILLABLE_PLANS.map((plan) => plan.billingKey);

const billingLogger = createScopedLogger({ service: "billing" });

const BILLING_TEST_MODE =
  process.env.SHOPIFY_BILLING_TEST_MODE === "true" ||
  process.env.NODE_ENV !== "production";

export function getPlanOptions() {
  return listPlanOptions();
}


export function getPlanDefinitionByTier(tier) {
  return findPlanByTier(tier) ?? DEFAULT_PLAN;
}

export async function syncSubscriptionFromShopify({
  merchantId,
  session,
  billing,
}) {
  if (!merchantId || !billing) {
    return null;
  }

  const response = await billing.check({
    session,
    plans: BILLING_PLAN_KEYS,
    isTest: BILLING_TEST_MODE,
    returnObject: true,
  });

  const active =
    response?.appSubscriptions?.find(
      (subscription) =>
        BILLING_PLAN_KEYS.includes(subscription.name) &&
        subscription.status === "ACTIVE",
    ) ?? null;

  const planDefinition = active
    ? findPlanByBillingKey(active.name) ?? DEFAULT_PLAN
    : DEFAULT_PLAN;

  const subscriptionPayload = {
    plan: planDefinition.tier,
    status: active?.status ?? "INACTIVE",
    shopifyBillingId: active?.id ?? null,
    trialEndsAt: computeTrialEnd(active),
    nextBillingAt: active?.currentPeriodEnd
      ? new Date(active.currentPeriodEnd)
      : null,
    orderLimit: planDefinition.allowances.orders,
    storeLimit: planDefinition.allowances.stores,
    updatedAt: new Date(),
  };

  await prisma.subscription.upsert({
    where: { merchantId },
    create: {
      merchantId,
      ...subscriptionPayload,
    },
    update: subscriptionPayload,
  });

  return subscriptionPayload;
}

export async function requestPlanChange({
  planTier,
  billing,
  session,
  returnUrl,
}) {
  const plan = findPlanByTier(planTier);
  if (!plan) {
    throw new Error(`Unknown plan tier: ${planTier}`);
  }

  const response = await billing.request({
    session,
    plan: plan.billingKey,
    isTest: BILLING_TEST_MODE,
    returnUrl,
  });

  const confirmationUrl =
    typeof response === "string"
      ? response
      : response?.confirmationUrl ?? response?.url ?? null;
  if (!confirmationUrl) {
    throw new Error("Missing Shopify billing confirmation URL. Please try again.");
  }

  return confirmationUrl;
}

function computeTrialEnd(subscription) {
  if (!subscription?.trialDays || !subscription.createdAt) {
    return null;
  }

  const date = new Date(subscription.createdAt);
  date.setUTCDate(date.getUTCDate() + subscription.trialDays);
  return date;
}

export async function applySubscriptionWebhook({ shopDomain, payload }) {
  if (!shopDomain || !payload) return;

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    include: { merchant: true },
  });

  if (!store?.merchantId) {
    billingLogger.warn("billing_webhook_missing_merchant", { shopDomain });
    return;
  }

  const existingSubscription = await prisma.subscription.findUnique({
    where: { merchantId: store.merchantId },
  });

  const planDefinition =
    findPlanByBillingKey(payload.name) ?? getPlanDefinitionByTier(null);
  const subscriptionPayload = {
    plan: planDefinition.tier,
    status: payload.status ?? "ACTIVE",
    shopifyBillingId:
      payload.admin_graphql_api_id ?? payload.id ?? undefined,
    trialEndsAt: payload.trial_ends_on ? new Date(payload.trial_ends_on) : null,
    nextBillingAt: payload.current_period_end
      ? new Date(payload.current_period_end)
      : null,
    orderLimit: planDefinition.allowances.orders,
    storeLimit: planDefinition.allowances.stores,
  };

  await prisma.subscription.upsert({
    where: { merchantId: store.merchantId },
    create: {
      merchantId: store.merchantId,
      ...subscriptionPayload,
    },
    update: subscriptionPayload,
  });

}

import pkg from "@prisma/client";
import prisma from "../db.server";

const { CredentialProvider, AttributionRuleType } = pkg;

const DEFAULT_TOUCHES = {
  [CredentialProvider.META_ADS]: [
    { ruleType: AttributionRuleType.LAST_TOUCH, weight: 1, windowHours: 24 },
    { ruleType: AttributionRuleType.FIRST_TOUCH, weight: 0.25, windowHours: 72 },
  ],
  [CredentialProvider.GOOGLE_ADS]: [
    { ruleType: AttributionRuleType.LAST_TOUCH, weight: 1, windowHours: 24 },
    { ruleType: AttributionRuleType.FIRST_TOUCH, weight: 0.2, windowHours: 72 },
  ],
  [CredentialProvider.BING_ADS]: [
    { ruleType: AttributionRuleType.LAST_TOUCH, weight: 1, windowHours: 24 },
  ],
  [CredentialProvider.TIKTOK_ADS]: [
    { ruleType: AttributionRuleType.LAST_TOUCH, weight: 1, windowHours: 24 },
    { ruleType: AttributionRuleType.FIRST_TOUCH, weight: 0.15, windowHours: 48 },
  ],
  [CredentialProvider.AMAZON_ADS]: [
    { ruleType: AttributionRuleType.LAST_TOUCH, weight: 1, windowHours: 24 },
    { ruleType: AttributionRuleType.FIRST_TOUCH, weight: 0.2, windowHours: 72 },
  ],
  [CredentialProvider.SNAPCHAT_ADS]: [
    { ruleType: AttributionRuleType.LAST_TOUCH, weight: 1, windowHours: 24 },
    { ruleType: AttributionRuleType.FIRST_TOUCH, weight: 0.15, windowHours: 48 },
  ],
};

const DEFAULT_PROVIDER_LIST = Object.keys(DEFAULT_TOUCHES);

export async function listAttributionRules(merchantId) {
  if (!merchantId) {
    return DEFAULT_PROVIDER_LIST.map((provider) => ({ provider, touches: DEFAULT_TOUCHES[provider] }));
  }
  const rows = await prisma.attributionRule.findMany({
    where: { merchantId },
  });
  const grouped = rows.reduce((acc, row) => {
    const provider = row.provider;
    if (!acc.has(provider)) {
      acc.set(provider, []);
    }
    acc.get(provider).push(row);
    return acc;
  }, new Map());

  return DEFAULT_PROVIDER_LIST.map((provider) => {
    const providerDefaults = DEFAULT_TOUCHES[provider] ?? [
      { ruleType: AttributionRuleType.LAST_TOUCH, weight: 1, windowHours: 24 },
    ];
    const existing = grouped.get(provider) ?? [];
    const existingMap = new Map(
      existing.map((row) => [row.ruleType, row]),
    );
    const touches = [...providerDefaults.map((defaultTouch) => {
      const override = existingMap.get(defaultTouch.ruleType);
      return {
        ruleType: defaultTouch.ruleType,
        weight: Number(override?.weight ?? defaultTouch.weight),
        windowHours: override ? override.windowHours : defaultTouch.windowHours,
      };
    })];

    existing.forEach((row) => {
      if (touches.some((touch) => touch.ruleType === row.ruleType)) return;
      touches.push({
        ruleType: row.ruleType,
        weight: Number(row.weight),
        windowHours: row.windowHours,
      });
    });

    return { provider, touches };
  });
}

export async function upsertAttributionRule({
  merchantId,
  provider,
  ruleType = AttributionRuleType.LAST_TOUCH,
  weight = 1,
  windowHours = 24,
}) {
  if (!merchantId || !provider) {
    throw new Error("MerchantId and provider are required for attribution rules");
  }
  if (!Object.values(AttributionRuleType).includes(ruleType)) {
    throw new Error(`Unsupported attribution rule type: ${ruleType}`);
  }
  return prisma.attributionRule.upsert({
    where: {
      merchantId_provider_ruleType: {
        merchantId,
        provider,
        ruleType,
      },
    },
    create: {
      merchantId,
      provider,
      ruleType,
      weight,
      windowHours,
    },
    update: {
      weight,
      windowHours,
    },
  });
}

export { listAttributionRules as getAttributionRules };

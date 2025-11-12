import pkg from "@prisma/client";
import prisma from "../db.server";

const { CredentialProvider } = pkg;

const DEFAULT_RULES = [
  {
    provider: CredentialProvider.META_ADS,
    ruleType: "LAST_TOUCH",
    weight: 1,
    windowHours: 24,
  },
  {
    provider: CredentialProvider.GOOGLE_ADS,
    ruleType: "LAST_TOUCH",
    weight: 1,
    windowHours: 24,
  },
  {
    provider: CredentialProvider.BING_ADS,
    ruleType: "LAST_TOUCH",
    weight: 1,
    windowHours: 24,
  },
  {
    provider: CredentialProvider.TIKTOK_ADS,
    ruleType: "LAST_TOUCH",
    weight: 1,
    windowHours: 24,
  },
];

export async function listAttributionRules(merchantId) {
  if (!merchantId) {
    return DEFAULT_RULES;
  }
  const rows = await prisma.attributionRule.findMany({
    where: { merchantId },
  });
  const map = new Map(rows.map((row) => [row.provider, row]));
  return DEFAULT_RULES.map((rule) => ({
    provider: rule.provider,
    ruleType: (map.get(rule.provider)?.ruleType ?? rule.ruleType).toUpperCase(),
    weight: Number(map.get(rule.provider)?.weight ?? rule.weight),
    windowHours: Number(map.get(rule.provider)?.windowHours ?? rule.windowHours),
  }));
}

export async function upsertAttributionRule({
  merchantId,
  provider,
  ruleType = "LAST_TOUCH",
  weight = 1,
  windowHours = 24,
}) {
  if (!merchantId || !provider) {
    throw new Error("MerchantId and provider are required for attribution rules");
  }
  return prisma.attributionRule.upsert({
    where: { merchantId_provider: { merchantId, provider } },
    create: {
      merchantId,
      provider,
      ruleType,
      weight,
      windowHours,
    },
    update: {
      ruleType,
      weight,
      windowHours,
    },
  });
}

export { listAttributionRules as getAttributionRules };

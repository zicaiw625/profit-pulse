/* eslint-env node */
import pkg from "@prisma/client";
import { PLAN_DEFINITIONS } from "../app/config/billing.js";
import { startOfDay, shiftDays } from "../app/utils/dates.server.js";

const { PrismaClient, PlanTier, CredentialProvider, SyncJobType, SyncJobStatus } =
  pkg;
const prisma = new PrismaClient();

const SHOP_DOMAIN =
  process.env.SEED_SHOP_DOMAIN ?? "northwind-apparel.myshopify.com";
const RANGE_DAYS = Number(process.env.SEED_METRIC_DAYS ?? 30);

async function main() {
  const { merchant, store } = await upsertMerchantAndStore(SHOP_DOMAIN);

  await prisma.dailyMetric.deleteMany({ where: { storeId: store.id } });
  await prisma.reconciliationIssue.deleteMany({ where: { storeId: store.id } });
  await prisma.adSpendRecord.deleteMany({ where: { storeId: store.id } });
  await prisma.paymentPayout.deleteMany({ where: { storeId: store.id } });
  await prisma.syncJob.deleteMany({ where: { storeId: store.id } });
  await prisma.adAccountCredential.deleteMany({ where: { storeId: store.id } });

  const aggregateRows = [];
  const productRows = [];
  const today = startOfDay(new Date());
  const skuCatalog = [
    { sku: "HD-0001", ratio: 0.38 },
    { sku: "BTL-099", ratio: 0.27 },
    { sku: "TR-441", ratio: 0.35 },
  ];

  for (let i = RANGE_DAYS - 1; i >= 0; i -= 1) {
    const date = shiftDays(today, -i);
    const baseRevenue = randomInRange(3200, 8200);
    const adSpend = randomInRange(900, 2100);
    const cogs = baseRevenue * randomInRange(0.35, 0.52);
    const shipping = baseRevenue * randomInRange(0.07, 0.12);
    const paymentFees = baseRevenue * 0.028;
    const netProfit = baseRevenue - (cogs + adSpend + shipping + paymentFees);
    const orders = Math.round(baseRevenue / randomInRange(85, 120));
    const units = Math.round(orders * randomInRange(1.1, 1.8));
    const refundRate = randomInRange(0.015, 0.06);
    const refundCount = Math.max(0, Math.round(orders * refundRate));
    const refundAmount = refundCount
      ? baseRevenue * refundRate * randomInRange(0.45, 0.95)
      : 0;

    aggregateRows.push({
      storeId: store.id,
      date,
      channel: "TOTAL",
      currency: merchant.primaryCurrency,
      orders,
      units,
      revenue: baseRevenue,
      adSpend,
      cogs,
      shippingCost: shipping,
      paymentFees,
      refundAmount,
      refunds: refundCount,
      grossProfit: baseRevenue - cogs - shipping - paymentFees,
      netProfit,
    });

    const baseUnits = units || 1;
    skuCatalog.forEach((sku) => {
      const skuRevenue = baseRevenue * sku.ratio;
      const skuNetProfit = netProfit * sku.ratio;
      const skuUnits = Math.round(baseUnits * sku.ratio);
      productRows.push({
        storeId: store.id,
        date,
        channel: "PRODUCT",
        productSku: sku.sku,
        currency: merchant.primaryCurrency,
        orders: Math.max(1, Math.round(orders * sku.ratio)),
        units: Math.max(1, skuUnits),
        revenue: skuRevenue,
        adSpend: adSpend * sku.ratio,
        cogs: cogs * sku.ratio,
        shippingCost: shipping * sku.ratio,
        paymentFees: paymentFees * sku.ratio,
        refundAmount: refundAmount * sku.ratio,
        refunds: Math.max(0, Math.round(refundCount * sku.ratio)),
        grossProfit: skuRevenue - cogs * sku.ratio - shipping * sku.ratio - paymentFees * sku.ratio,
        netProfit: skuNetProfit,
      });
    });
  }

  if (aggregateRows.length) {
    await prisma.dailyMetric.createMany({
      data: aggregateRows.concat(productRows),
    });
  }

  const refundRecords = [];
  for (let i = 0; i < Math.min(8, RANGE_DAYS); i += 1) {
    const refundDate = shiftDays(today, -i);
    const sku = skuCatalog[i % skuCatalog.length];
    const amount = randomInRange(45, 180);
    refundRecords.push({
      storeId: store.id,
      orderShopifyId: `seed-order-${i}`,
      shopifyRefundId: `seed-refund-${i}`,
      processedAt: refundDate,
      currency: merchant.primaryCurrency,
      amount,
      reason: i % 2 === 0 ? "Damaged item" : "Size issue",
      restock: false,
      lineItems: [
        {
          quantity: 1,
          subtotal_set: { shop_money: { amount } },
          line_item: {
            sku: sku.sku,
            title: `${sku.sku} Sample`,
          },
        },
      ],
      transactions: [
        {
          amount: -amount,
          currency: merchant.primaryCurrency,
        },
      ],
    });
  }

  if (refundRecords.length) {
    await prisma.refundRecord.createMany({ data: refundRecords });
  }

  await prisma.reconciliationIssue.createMany({
    data: [
      {
        storeId: store.id,
        issueType: "SHOPIFY_VS_PAYMENT",
        issueDate: shiftDays(today, -1),
        orderId: "#1045",
        amountDelta: 42.1,
        details: { message: "Shopify Payments fee mismatch for payout P-554" },
      },
      {
        storeId: store.id,
        issueType: "SHOPIFY_VS_ADS",
        issueDate: shiftDays(today, -2),
        orderId: "#1050",
        amountDelta: 0,
        details: {
          message: "Meta conversion reported with no matching Shopify order",
        },
      },
      {
        storeId: store.id,
        issueType: "SHOPIFY_VS_ADS",
        issueDate: shiftDays(today, -3),
        orderId: "#1038",
        amountDelta: 18.32,
        details: {
          message: "Google Ads shows two conversions for one order",
        },
      },
    ],
  });

  await seedIntegrations(store);

  console.log(`Seeded demo data for ${store.shopDomain}`);
}

async function upsertMerchantAndStore(shopDomain) {
  let store = await prisma.store.findUnique({
    where: { shopDomain },
    include: { merchant: true },
  });

  if (store) {
    return { merchant: store.merchant, store };
  }

  const defaultPlan = PLAN_DEFINITIONS.BASIC;
  const merchant = await prisma.merchantAccount.create({
    data: {
      name: shopDomain.replace(".myshopify.com", ""),
      primaryCurrency: "USD",
      primaryTimezone: "America/New_York",
      subscription: {
        create: {
          plan: defaultPlan?.tier ?? PlanTier.BASIC,
          status: "ACTIVE",
          orderLimit: defaultPlan?.allowances?.orders ?? 500,
          storeLimit: defaultPlan?.allowances?.stores ?? 1,
        },
      },
    },
  });

  store = await prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopDomain,
      currency: merchant.primaryCurrency,
      timezone: merchant.primaryTimezone,
    },
    include: { merchant: true },
  });

  return { merchant: store.merchant, store };
}

function randomInRange(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

async function seedIntegrations(store) {
  const today = startOfDay(new Date());
  const metaCredential = await prisma.adAccountCredential.create({
    data: {
      merchantId: store.merchantId,
      storeId: store.id,
      provider: CredentialProvider.META_ADS,
      accountName: "Meta Ads Main",
      accountId: "act_meta_demo",
      encryptedSecret: "demo",
      lastSyncedAt: shiftDays(today, -1),
    },
  });

  const googleCredential = await prisma.adAccountCredential.create({
    data: {
      merchantId: store.merchantId,
      storeId: store.id,
      provider: CredentialProvider.GOOGLE_ADS,
      accountName: "Google Ads EMEA",
      accountId: "act_google_demo",
      encryptedSecret: "demo",
      lastSyncedAt: shiftDays(today, -1),
    },
  });

  const adRecords = [];
  const campaigns = [
    { id: "cmp-retarget", name: "Retargeting" },
    { id: "cmp-prospect", name: "Prospecting" },
  ];

  [CredentialProvider.META_ADS, CredentialProvider.GOOGLE_ADS].forEach(
    (provider) => {
      for (let i = 0; i < 5; i += 1) {
        const date = shiftDays(today, -i);
        campaigns.forEach((campaign, idx) => {
          const spend = randomInRange(180, 420);
          adRecords.push({
            storeId: store.id,
            provider,
            accountId:
              provider === CredentialProvider.META_ADS
                ? metaCredential.accountId
                : googleCredential.accountId,
            campaignId: campaign.id,
            campaignName: campaign.name,
            adSetId: `adset-${idx}`,
            adSetName: `Ad set ${idx + 1}`,
            adId: `ad-${idx}`,
            adName: `Creative ${idx + 1}`,
            date,
            currency: store.currency,
            spend,
            impressions: Math.round(spend * randomInRange(50, 80)),
            clicks: Math.round(spend * randomInRange(1, 3)),
            conversions: Math.round(spend * randomInRange(0.3, 0.8)),
            compositeKey: buildCompositeKey(
              store.id,
              provider,
              date,
              campaign.id,
              `adset-${idx}`,
              `ad-${idx}`,
            ),
          });
        });
      }
    },
  );

  if (adRecords.length) {
    await prisma.adSpendRecord.createMany({
      data: adRecords,
    });
  }

  const payouts = [];
  for (let i = 0; i < 5; i += 1) {
    const payoutDate = shiftDays(today, -i);
    const gross = randomInRange(2500, 5400);
    const fees = gross * 0.029 + 30;
    payouts.push({
      storeId: store.id,
      provider: CredentialProvider.SHOPIFY_PAYMENTS,
      payoutId: `po_${payoutDate.getTime()}`,
      payoutDate,
      currency: store.currency,
      grossAmount: gross,
      feeTotal: fees,
      netAmount: gross - fees,
      transactions: { count: Math.round(gross / randomInRange(80, 140)) },
    });
  }

  await prisma.paymentPayout.createMany({
    data: payouts,
  });

  await prisma.store.update({
    where: { id: store.id },
    data: { paymentsLastSyncedAt: payouts[0]?.payoutDate ?? null },
  });

  await prisma.syncJob.createMany({
    data: [
      {
        storeId: store.id,
        provider: CredentialProvider.META_ADS,
        jobType: SyncJobType.AD_SPEND,
        status: SyncJobStatus.SUCCESS,
        processedCount: adRecords.length,
        startedAt: shiftDays(today, -1),
        completedAt: shiftDays(today, -1),
      },
      {
        storeId: store.id,
        provider: CredentialProvider.GOOGLE_ADS,
        jobType: SyncJobType.AD_SPEND,
        status: SyncJobStatus.SUCCESS,
        processedCount: adRecords.length,
        startedAt: shiftDays(today, -1),
        completedAt: shiftDays(today, -1),
      },
      {
        storeId: store.id,
        provider: CredentialProvider.SHOPIFY_PAYMENTS,
        jobType: SyncJobType.PAYMENT_PAYOUT,
        status: SyncJobStatus.SUCCESS,
        processedCount: payouts.length,
        startedAt: shiftDays(today, -1),
        completedAt: shiftDays(today, -1),
      },
    ],
  });
}

function buildCompositeKey(
  storeId,
  provider,
  date,
  campaignId,
  adSetId,
  adId,
) {
  const dateKey = startOfDay(date).toISOString().slice(0, 10);
  return [storeId, dateKey, provider, campaignId, adSetId, adId].join(":");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

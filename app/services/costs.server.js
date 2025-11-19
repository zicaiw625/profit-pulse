import pkg from "@prisma/client";
import prisma from "../db.server.js";

const { CostType } = pkg;

export async function getCostConfiguration(storeId) {
  const [skuCosts, templates] = await Promise.all([
    prisma.skuCost.findMany({
      where: { storeId },
      orderBy: { sku: "asc" },
    }),
    prisma.costTemplate.findMany({
      where: { storeId },
      include: { lines: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    skuCosts,
    templates,
  };
}

export async function getActiveSkuCostMap(storeId, asOf = new Date()) {
  const costs = await prisma.skuCost.findMany({
    where: {
      storeId,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  const map = new Map();
  for (const cost of costs) {
    if (!map.has(cost.sku)) {
      map.set(cost.sku, Number(cost.costAmount));
    }
  }
  return map;
}

export async function getVariableCostTemplates(storeId) {
  return prisma.costTemplate.findMany({
    where: { storeId },
    include: { lines: true },
  });
}

export async function seedDemoCostConfiguration({ storeId, currency = "USD" }) {
  await prisma.$transaction(async (tx) => {
    await tx.costTemplateLine.deleteMany({
      where: { template: { storeId } },
    });
    await tx.costTemplate.deleteMany({ where: { storeId } });
    await tx.skuCost.deleteMany({ where: { storeId } });

    await tx.skuCost.createMany({
      data: [
        {
          storeId,
          sku: "HD-0001",
          costCurrency: currency,
          costAmount: 18.75,
        },
        {
          storeId,
          sku: "BTL-099",
          costCurrency: currency,
          costAmount: 6.5,
        },
        {
          storeId,
          sku: "TR-441",
          costCurrency: currency,
          costAmount: 42.25,
        },
        {
          storeId,
          sku: "PK-222",
          costCurrency: currency,
          costAmount: 3.8,
        },
      ],
    });

    await tx.costTemplate.create({
      data: {
        storeId,
        name: "Shopify Payments fee",
        type: CostType.PAYMENT_FEE,
        config: {
          gateway: "shopify_payments",
          appliesTo: "TOTAL",
        },
        lines: {
          create: [
            {
              label: "Fixed fee",
              flatAmount: 0.3,
              appliesTo: "ORDER_TOTAL",
            },
            {
              label: "Percentage fee",
              percentageRate: 0.029,
              appliesTo: "ORDER_TOTAL",
            },
          ],
        },
      },
    });

    await tx.costTemplate.create({
      data: {
        storeId,
        name: "PayPal fee",
        type: CostType.PAYMENT_FEE,
        config: {
          gateway: "paypal",
          appliesTo: "TOTAL",
        },
        lines: {
          create: [
            {
              label: "Fixed fee",
              flatAmount: 0.3,
              appliesTo: "ORDER_TOTAL",
            },
            {
              label: "Percentage fee",
              percentageRate: 0.034,
              appliesTo: "ORDER_TOTAL",
            },
          ],
        },
      },
    });

    await tx.costTemplate.create({
      data: {
        storeId,
        name: "Average shipping label",
        type: CostType.SHIPPING,
        config: {
          appliesTo: "SHIPPING_REVENUE",
          defaultRate: 0.65,
        },
        lines: {
          create: [
            {
              label: "Base shipping cost",
              percentageRate: 0.6,
              appliesTo: "SHIPPING_REVENUE",
            },
            {
              label: "Packaging",
              flatAmount: 0.75,
              appliesTo: "ORDER_TOTAL",
            },
          ],
        },
      },
    });

    await tx.costTemplate.create({
      data: {
        storeId,
        name: "Platform commission",
        type: CostType.PLATFORM_FEE,
        config: {
          channel: "POS",
          appliesTo: "SUBTOTAL",
        },
        lines: {
          create: [
            {
              label: "Marketplace fee",
              percentageRate: 0.12,
              appliesTo: "SUBTOTAL",
            },
          ],
        },
      },
    });
  });

  return getCostConfiguration(storeId);
}

export async function importSkuCostsFromCsv({ storeId, csv, defaultCurrency = "USD" }) {
  if (!csv) {
    throw new Error("CSV content is required to import costs");
  }

  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    throw new Error("CSV file is empty");
  }

  const headers = lines[0]
    .split(",")
    .map((header) => header.trim().toLowerCase());

  const skuIdx = headers.indexOf("sku");
  const costIdx = headers.indexOf("cost");
  const currencyIdx = headers.indexOf("currency");
  const effectiveFromIdx = headers.indexOf("effective_from");

  if (skuIdx === -1 || costIdx === -1) {
    throw new Error("CSV must include at least 'sku' and 'cost' columns");
  }

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    const sku = parts[skuIdx]?.trim();
    const costValue = Number(parts[costIdx]);
    if (!sku || !Number.isFinite(costValue)) {
      continue;
    }
    const currency = currencyIdx !== -1 ? parts[currencyIdx]?.trim() || defaultCurrency : defaultCurrency;
    const effectiveFrom = effectiveFromIdx !== -1 && parts[effectiveFromIdx]
      ? new Date(parts[effectiveFromIdx])
      : new Date();
    rows.push({ sku, costAmount: costValue, costCurrency: currency, effectiveFrom });
  }

  if (!rows.length) {
    throw new Error("No valid rows detected in CSV");
  }

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.skuCost.create({
        data: {
          storeId,
          sku: row.sku,
          costAmount: row.costAmount,
          costCurrency: row.costCurrency,
          effectiveFrom: row.effectiveFrom,
        },
      });
    }
  });

  return rows.length;
}

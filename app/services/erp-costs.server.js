import prisma from "../db.server";

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) ? number : 0;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function syncErpCosts({ storeId }) {
  if (!storeId) {
    throw new Error("Store is required to sync ERP costs");
  }
  const url = process.env.ERP_COST_SYNC_URL;
  if (!url) {
    throw new Error("ERP cost sync URL is not configured");
  }

  const response = await fetch(`${url}?storeId=${storeId}`);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `ERP cost sync failed (${response.status}): ${message.slice(0, 200)}`,
    );
  }

  const payload = await response.json();
  const records = Array.isArray(payload?.costs) ? payload.costs : [];
  const validRecords = records.filter((record) => record?.sku?.toString().trim());
  if (!validRecords.length) {
    return 0;
  }

  const skus = Array.from(new Set(validRecords.map((record) => record?.sku).filter(Boolean)));
  await prisma.skuCost.deleteMany({
    where: {
      storeId,
      sku: { in: skus },
      source: "ERP",
    },
  });

  await prisma.$transaction(
    validRecords.map((record) =>
      prisma.skuCost.create({
        data: {
          storeId,
          sku: record?.sku?.toString().trim(),
          variantId: record?.variantId ? String(record.variantId) : null,
          costAmount: toNumber(record.cost),
          costCurrency: record.currency ?? "USD",
          effectiveFrom: parseDate(record.effectiveFrom) ?? new Date(),
          source: "ERP",
        },
      }),
    ),
  );

  return validRecords.length;
}

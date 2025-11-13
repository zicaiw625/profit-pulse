import prisma from "../db.server";
import shopify from "../shopify.server";

const VARIANT_PAGE_SIZE = 100;

export async function syncInventoryAndCosts({ store, session }) {
  if (!store?.id) {
    throw new Error("Store is required to sync inventory.");
  }
  if (!session) {
    throw new Error("Shopify admin session is required for inventory sync.");
  }

  const graphql = new shopify.api.clients.Graphql({ session });
  const variants = await fetchAllVariants(graphql);
  if (!variants.length) {
    return { variants: 0, inventoryRows: 0, costsUpdated: 0 };
  }

  const inventoryRows = [];
  const costEntries = [];

  variants.forEach((variant) => {
    if (variant.costAmount && variant.costAmount > 0) {
      costEntries.push({
        sku: variant.sku,
        amount: variant.costAmount,
        currency: variant.costCurrency ?? store.currency ?? "USD",
      });
    }
    variant.inventoryLevels.forEach((level) => {
      inventoryRows.push({
        storeId: store.id,
        inventoryItemId: variant.inventoryItemId,
        sku: variant.sku,
        locationId: level.locationId,
        quantity: level.quantity,
        unitCost: variant.costAmount ?? null,
        costCurrency: variant.costCurrency ?? store.currency ?? "USD",
      });
    });
  });

  await prisma.$transaction(async (tx) => {
    await tx.inventoryLevel.deleteMany({ where: { storeId: store.id } });
    if (inventoryRows.length) {
      const chunks = chunkArray(inventoryRows, 100);
      for (const chunk of chunks) {
        await tx.inventoryLevel.createMany({ data: chunk });
      }
    }

    if (costEntries.length) {
      const existing = await tx.skuCost.findMany({
        where: { storeId: store.id },
      });
      const costMap = new Map(existing.map((row) => [row.sku, row]));
      for (const entry of costEntries) {
        if (!entry.sku) continue;
        const existingEntry = costMap.get(entry.sku);
        if (existingEntry) {
          await tx.skuCost.update({
            where: { id: existingEntry.id },
            data: {
              costAmount: entry.amount,
              costCurrency: entry.currency,
              source: "SHOPIFY",
              effectiveFrom: new Date(),
            },
          });
        } else {
          await tx.skuCost.create({
            data: {
              storeId: store.id,
              sku: entry.sku,
              costAmount: entry.amount,
              costCurrency: entry.currency,
              source: "SHOPIFY",
            },
          });
        }
      }
    }
  });

  return {
    variants: variants.length,
    inventoryRows: inventoryRows.length,
    costsUpdated: costEntries.length,
  };
}

async function fetchAllVariants(graphqlClient) {
  const variants = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await graphqlClient.query({
      data: {
        query: VARIANT_QUERY,
        variables: {
          cursor,
          first: VARIANT_PAGE_SIZE,
        },
      },
    });
    const edges =
      response?.data?.productVariants?.edges ||
      response?.body?.data?.productVariants?.edges ||
      [];
    edges.forEach((edge) => {
      const node = edge.node;
      if (!node) return;
      const inventoryItem = node.inventoryItem ?? {};
      const sku = node.sku || node.id;
      const unitCost = inventoryItem.unitCost ?? {};
      const inventoryLevels =
        inventoryItem.inventoryLevels?.edges?.map((lvl) => ({
          quantity: Number(lvl.node?.available ?? lvl.node?.quantity ?? 0),
          locationId: lvl.node?.location?.id ?? null,
        })) ?? [];
      variants.push({
        id: node.id,
        sku,
        inventoryItemId: inventoryItem.id,
        costAmount: unitCost.amount ? Number(unitCost.amount) : null,
        costCurrency: unitCost.currencyCode,
        inventoryLevels,
      });
    });
    hasNextPage =
      response?.data?.productVariants?.pageInfo?.hasNextPage ??
      response?.body?.data?.productVariants?.pageInfo?.hasNextPage ??
      false;
    cursor =
      response?.data?.productVariants?.pageInfo?.endCursor ??
      response?.body?.data?.productVariants?.pageInfo?.endCursor ??
      null;
  }

  return variants;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const VARIANT_QUERY = `
  query SyncInventoryVariants($cursor: String, $first: Int!) {
    productVariants(first: $first, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          sku
          inventoryItem {
            id
            unitCost {
              amount
              currencyCode
            }
            inventoryLevels(first: 50) {
              edges {
                node {
                  available
                  quantity
                  location {
                    id
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

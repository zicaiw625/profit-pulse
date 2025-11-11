import pkg from "@prisma/client";
import prisma from "../../db.server";
import shopify from "../../shopify.server";
import { startSyncJob, finishSyncJob, failSyncJob } from "./jobs.server";

const { CredentialProvider, SyncJobType } = pkg;

export async function syncShopifyPayments({ store, session, days = 7 }) {
  if (!store?.id) {
    throw new Error("Store is required");
  }
  if (!session) {
    throw new Error("Shopify admin session is required to sync payouts");
  }

  const job = await startSyncJob({
    storeId: store.id,
    jobType: SyncJobType.PAYMENT_PAYOUT,
    provider: CredentialProvider.SHOPIFY_PAYMENTS,
    metadata: { days },
  });

  try {
    const restClient = new shopify.api.clients.Rest({ session });
    const payouts = await collectPayouts({ restClient, days });

    for (const payout of payouts) {
      const transactions = await fetchPayoutTransactions({ restClient, payoutId: payout.id });
      await prisma.paymentPayout.upsert({
        where: {
          storeId_payoutId: {
            storeId: store.id,
            payoutId: payout.id,
          },
        },
        create: mapPayout(store, payout, transactions),
        update: mapPayout(store, payout, transactions),
      });
    }

    await prisma.store.update({
      where: { id: store.id },
      data: { paymentsLastSyncedAt: new Date() },
    });

    await finishSyncJob(job.id, {
      processedCount: payouts.length,
    });

    return { processed: payouts.length };
  } catch (error) {
    await failSyncJob(job.id, error);
    throw error;
  }
}

async function collectPayouts({ restClient, days }) {
  const minDate = new Date();
  minDate.setUTCDate(minDate.getUTCDate() - (Math.max(days, 1) - 1));
  let cursor = null;
  const payouts = [];

  do {
    const response = await restClient.get({
      path: "shopify_payments/payouts.json",
      query: {
        status: "paid",
        limit: 50,
        date_min: minDate.toISOString(),
        page_info: cursor ?? undefined,
      },
    });

    const batch = response.body?.payouts ?? [];
    payouts.push(...batch);
    cursor = response.pageInfo?.nextPage?.query?.page_info ?? null;
  } while (cursor);

  return payouts;
}

async function fetchPayoutTransactions({ restClient, payoutId }) {
  const response = await restClient.get({
    path: `shopify_payments/payouts/${payoutId}/transactions.json`,
    query: { limit: 250 },
  });
  return response.body?.transactions ?? [];
}

function mapPayout(store, payout, transactions) {
  const summary = payout.summary ?? {};
  const grossAmount = Number(
    summary.adjusted_gross_amount ?? payout.amount ?? 0,
  );
  const feeTotal = Number(summary.charges_fee_amount ?? 0) +
    Number(summary.adjustments_fee_amount ?? 0);
  const netAmount = Number(summary.net_amount ?? payout.net ?? payout.amount ?? 0);

  return {
    storeId: store.id,
    provider: CredentialProvider.SHOPIFY_PAYMENTS,
    payoutId: payout.id,
    status: payout.status,
    payoutDate: new Date(payout.arrival_date || payout.date || Date.now()),
    currency: payout.currency || store.currency,
    grossAmount,
    feeTotal,
    netAmount,
    transactions,
  };
}

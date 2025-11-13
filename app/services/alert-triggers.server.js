import prisma from "../db.server";
import { sendSlackNotification } from "./notifications.server";
import { startOfDay, shiftDays, resolveTimezone } from "../utils/dates.server.js";
import { getExchangeRate } from "./exchange-rates.server.js";
import { formatCurrency, formatPercent } from "../utils/formatting";

const DEFAULT_ROAS_THRESHOLD = 1.0;
const NET_PROFIT_DROP_PERCENT = 0.3;
const HIGH_ROAS_NEGATIVE_PROFIT_THRESHOLD = 3.5;
const MIN_ADSET_SPEND_ALERT = 150;
const MAX_HIGH_ROAS_ALERTS = 3;
const PAYMENT_FEE_SPIKE_INCREASE = 0.5;
const PAYMENT_FEE_LOOKBACK_DAYS = 7;
const MIN_REVENUE_FOR_FEE_ALERT = 200;
const AD_CHANNELS = [
  "META_ADS",
  "GOOGLE_ADS",
  "TIKTOK_ADS",
  "BING_ADS",
  "SNAPCHAT_ADS",
  "AMAZON_ADS",
];

export async function evaluatePerformanceAlerts({ store, thresholds = {} }) {
  if (!store?.id) return [];

  const storeRecord = await prisma.store.findUnique({
    where: { id: store.id },
    include: { merchant: true },
  });

  const resolvedStore = storeRecord ?? store;
  if (!resolvedStore?.merchantId) return [];

  const timezone = resolveTimezone({ store: resolvedStore });
  const today = startOfDay(new Date(), { timezone });
  const yesterday = shiftDays(today, -1, { timezone });

  const [todayMetric, yesterdayMetric] = await Promise.all([
    prisma.dailyMetric.findFirst({
      where: {
        storeId: resolvedStore.id,
        channel: "TOTAL",
        productSku: null,
        date: today,
      },
    }),
    prisma.dailyMetric.findFirst({
      where: {
        storeId: resolvedStore.id,
        channel: "TOTAL",
        productSku: null,
        date: yesterday,
      },
    }),
  ]);

  const flags = [];
  if (todayMetric?.netProfit < 0) {
    flags.push({
      type: "NEGATIVE_NET_PROFIT",
      value: todayMetric.netProfit,
    });
  }

  if (yesterdayMetric && todayMetric) {
    const prevProfit = Number(yesterdayMetric.netProfit || 0);
    const currentProfit = Number(todayMetric.netProfit || 0);
    if (
      prevProfit > 0 &&
      currentProfit / prevProfit <= (thresholds.profitDrop ?? NET_PROFIT_DROP_PERCENT)
    ) {
      flags.push({
        type: "NET_PROFIT_DROP",
        prevProfit,
        currentProfit,
      });
    }
  }

  if (todayMetric?.adSpend > 0) {
    const roas = Number(todayMetric.revenue || 0) / Number(todayMetric.adSpend || 1);
    if (roas < (thresholds.roas ?? DEFAULT_ROAS_THRESHOLD)) {
      flags.push({
        type: "LOW_ROAS",
        roas,
      });
    }
  }

  const [feeSpike, highRoasFlags] = await Promise.all([
    detectPaymentFeeSpike({
      store: resolvedStore,
      timezone,
      todayMetric,
      thresholds,
    }),
    detectHighRoasNegativeProfit({
      store: resolvedStore,
      timezone,
      thresholds,
    }),
  ]);

  if (feeSpike) {
    flags.push(feeSpike);
  }

  if (highRoasFlags.length) {
    flags.push(...highRoasFlags);
  }

  if (!flags.length) {
    return [];
  }

  const text = buildAlertMessage(resolvedStore, flags);

  await sendSlackNotification({
    merchantId: resolvedStore.merchantId,
    text,
    payload: buildSlackBlockPayload(resolvedStore.shopDomain, flags),
  });

  return flags;
}

function buildAlertMessage(store, flags) {
  const prefix = `⚠️ ${store.shopDomain} performance alerts:`;
  const lines = flags.map((flag) => {
    switch (flag.type) {
      case "NEGATIVE_NET_PROFIT":
        return `Net profit dipped negative (${flag.value.toFixed(2)}).`;
      case "NET_PROFIT_DROP":
        return `Net profit dropped from ${flag.prevProfit.toFixed(2)} to ${flag.currentProfit.toFixed(2)}.`;
      case "LOW_ROAS":
        return `ROAS ${flag.roas.toFixed(2)} below threshold.`;
      case "PAYMENT_FEE_SPIKE":
        return `Payment fees jumped to ${formatPercent(flag.ratio)} (avg ${formatPercent(
          flag.baseline,
        )}).`;
      case "HIGH_ROAS_NEGATIVE_PROFIT": {
        const label = flag.label ?? "an ad set";
        const roas = flag.roas?.toFixed(2) ?? "?";
        return `High ROAS (${roas}) but negative profit ${formatCurrency(
          flag.netProfit,
          flag.currency,
        )} on ${label}.`;
      }
      default:
        return "Performance deviation detected.";
    }
  });
  return `${prefix}\n${lines.join("\n")}`;
}

function buildSlackBlockPayload(shopDomain, flags) {
  const header = {
    type: "header",
    text: { type: "plain_text", text: `${shopDomain} performance alerts`, emoji: true },
  };
  const sections = flags.map((flag) => {
    let text = "";
    switch (flag.type) {
      case "NEGATIVE_NET_PROFIT":
        text = `Net profit negative: ${flag.value.toFixed(2)}`;
        break;
      case "NET_PROFIT_DROP":
        text = `Net profit dropped from ${flag.prevProfit.toFixed(2)} to ${flag.currentProfit.toFixed(2)}`;
        break;
      case "LOW_ROAS":
        text = `ROAS low (${flag.roas.toFixed(2)})`;
        break;
      case "PAYMENT_FEE_SPIKE":
        text = `Payment fees ${formatPercent(flag.ratio)} vs avg ${formatPercent(
          flag.baseline,
        )}`;
        break;
      case "HIGH_ROAS_NEGATIVE_PROFIT": {
        const spendText = formatCurrency(flag.spend, flag.currency);
        text = `High ROAS (${flag.roas?.toFixed(2) ?? "?"}) but ${formatCurrency(
          flag.netProfit,
          flag.currency,
        )} net on ${flag.label ?? "ad set"} (spend ${spendText})`;
        break;
      }
      default:
        text = "Unknown performance alert";
    }
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text,
      },
    };
  });

  return {
    blocks: [header, ...sections],
  };
}

async function detectPaymentFeeSpike({
  store,
  timezone,
  todayMetric,
  thresholds,
}) {
  if (!todayMetric) {
    return null;
  }

  const masterCurrency = store.merchant?.primaryCurrency ?? store.currency ?? "USD";
  const lookbackDays = Math.max(
    Number(thresholds.paymentFeeLookbackDays ?? PAYMENT_FEE_LOOKBACK_DAYS),
    2,
  );
  const baselineStart = shiftDays(todayMetric.date ?? new Date(), -lookbackDays, {
    timezone,
  });

  const trailingMetrics = await prisma.dailyMetric.findMany({
    where: {
      storeId: store.id,
      channel: "TOTAL",
      productSku: null,
      date: {
        gte: baselineStart,
        lt: startOfDay(todayMetric.date ?? new Date(), { timezone }),
      },
    },
  });

  if (!trailingMetrics.length) {
    return null;
  }

  const currencies = new Set([masterCurrency]);
  if (todayMetric.currency) {
    currencies.add(todayMetric.currency);
  }
  for (const metric of trailingMetrics) {
    if (metric.currency) {
      currencies.add(metric.currency);
    }
  }

  const rateMap = await buildRateMap(currencies, masterCurrency);

  let trailingRevenue = 0;
  let trailingFees = 0;
  let samples = 0;
  for (const metric of trailingMetrics) {
    const revenue = convertAmount(metric.revenue, metric.currency, masterCurrency, rateMap);
    const fees = convertAmount(metric.paymentFees, metric.currency, masterCurrency, rateMap);
    trailingRevenue += revenue;
    trailingFees += fees;
    if (revenue > 0) {
      samples += 1;
    }
  }

  if (samples < 2 || trailingRevenue <= 0) {
    return null;
  }

  const baselineRatio = trailingFees / trailingRevenue;
  const todayRevenue = convertAmount(
    todayMetric.revenue,
    todayMetric.currency,
    masterCurrency,
    rateMap,
  );
  const todayFees = convertAmount(
    todayMetric.paymentFees,
    todayMetric.currency,
    masterCurrency,
    rateMap,
  );

  if (todayRevenue <= 0 || todayFees <= 0) {
    return null;
  }

  const ratio = todayFees / todayRevenue;
  const spikeMultiplier = Number(
    thresholds.paymentFeeIncrease ?? PAYMENT_FEE_SPIKE_INCREASE,
  );
  const minRevenue = Number(thresholds.minRevenueForFees ?? MIN_REVENUE_FOR_FEE_ALERT);

  if (
    baselineRatio > 0 &&
    ratio >= baselineRatio * (1 + spikeMultiplier) &&
    todayRevenue >= minRevenue
  ) {
    return {
      type: "PAYMENT_FEE_SPIKE",
      ratio,
      baseline: baselineRatio,
      revenue: todayRevenue,
      paymentFees: todayFees,
      currency: masterCurrency,
    };
  }

  return null;
}

async function detectHighRoasNegativeProfit({ store, timezone, thresholds }) {
  const lookbackDays = Math.max(Number(thresholds.adsetLookbackDays ?? 3), 1);
  const roasThreshold = Number(
    thresholds.highRoas ?? HIGH_ROAS_NEGATIVE_PROFIT_THRESHOLD,
  );
  const minSpend = Number(thresholds.minAdsetSpend ?? MIN_ADSET_SPEND_ALERT);
  const masterCurrency = store.merchant?.primaryCurrency ?? store.currency ?? "USD";
  const end = startOfDay(new Date(), { timezone });
  const start = shiftDays(end, -(lookbackDays - 1), { timezone });

  const [adSpendRows, channelMetrics] = await Promise.all([
    prisma.adSpendRecord.findMany({
      where: {
        storeId: store.id,
        date: { gte: start, lte: end },
      },
    }),
    prisma.dailyMetric.findMany({
      where: {
        storeId: store.id,
        channel: { in: AD_CHANNELS },
        productSku: null,
        date: { gte: start, lte: end },
      },
    }),
  ]);

  if (!adSpendRows.length || !channelMetrics.length) {
    return [];
  }

  const currencies = new Set([masterCurrency]);
  for (const record of adSpendRows) {
    if (record.currency) {
      currencies.add(record.currency);
    }
  }
  for (const metric of channelMetrics) {
    if (metric.currency) {
      currencies.add(metric.currency);
    }
  }

  const rateMap = await buildRateMap(currencies, masterCurrency);

  const providerTotals = new Map();
  for (const metric of channelMetrics) {
    const key = metric.channel;
    const totals = providerTotals.get(key) || {
      revenue: 0,
      netProfit: 0,
      adSpend: 0,
    };
    totals.revenue += convertAmount(
      metric.revenue,
      metric.currency,
      masterCurrency,
      rateMap,
    );
    totals.netProfit += convertAmount(
      metric.netProfit,
      metric.currency,
      masterCurrency,
      rateMap,
    );
    totals.adSpend += convertAmount(
      metric.adSpend,
      metric.currency,
      masterCurrency,
      rateMap,
    );
    providerTotals.set(key, totals);
  }

  const providerSpendTotals = new Map();
  const adsetAggregates = new Map();

  for (const record of adSpendRows) {
    const provider = record.provider;
    const adSetKey = record.adSetId ?? record.campaignId ?? "adset";
    const key = `${provider}:${adSetKey}`;
    const spend = convertAmount(record.spend, record.currency, masterCurrency, rateMap);
    const existing = adsetAggregates.get(key) || {
      provider,
      adSetId: record.adSetId,
      adSetName: record.adSetName,
      campaignName: record.campaignName,
      spend: 0,
      conversions: 0,
    };
    existing.spend += spend;
    existing.conversions += Number(record.conversions || 0);
    adsetAggregates.set(key, existing);

    providerSpendTotals.set(provider, (providerSpendTotals.get(provider) || 0) + spend);
  }

  const alerts = [];
  for (const aggregate of adsetAggregates.values()) {
    const providerTotal = providerTotals.get(aggregate.provider);
    const providerSpend = providerSpendTotals.get(aggregate.provider) || 0;
    if (!providerTotal || providerSpend <= 0 || aggregate.spend < minSpend) {
      continue;
    }

    const share = aggregate.spend / providerSpend;
    const estimatedRevenue = providerTotal.revenue * share;
    const estimatedNetProfit = providerTotal.netProfit * share;
    const roas = aggregate.spend > 0 ? estimatedRevenue / aggregate.spend : null;

    if (roas !== null && roas >= roasThreshold && estimatedNetProfit < 0) {
      alerts.push({
        type: "HIGH_ROAS_NEGATIVE_PROFIT",
        provider: aggregate.provider,
        label: buildAdsetLabel(aggregate),
        roas,
        netProfit: estimatedNetProfit,
        spend: aggregate.spend,
        currency: masterCurrency,
      });
    }
  }

  alerts.sort((a, b) => Math.abs(b.netProfit) - Math.abs(a.netProfit));
  return alerts.slice(0, thresholds.maxAdsetAlerts ?? MAX_HIGH_ROAS_ALERTS);
}

async function buildRateMap(currencies, masterCurrency) {
  const map = new Map();
  map.set(masterCurrency, 1);
  const unique = Array.from(currencies).filter(
    (currency) => currency && currency !== masterCurrency,
  );
  await Promise.all(
    unique.map(async (currency) => {
      const rate = await getExchangeRate({ base: currency, quote: masterCurrency });
      map.set(currency, Number(rate) || 1);
    }),
  );
  return map;
}

function convertAmount(value, currency, masterCurrency, rateMap) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (!currency || currency === masterCurrency) {
    return numeric;
  }
  const rate = rateMap.get(currency) ?? 1;
  return numeric * rate;
}

function buildAdsetLabel({ adSetName, campaignName }) {
  if (adSetName && campaignName) {
    return `${campaignName} · ${adSetName}`;
  }
  if (adSetName) {
    return adSetName;
  }
  if (campaignName) {
    return campaignName;
  }
  return "Ad set";
}

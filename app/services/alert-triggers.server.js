import pkg from "@prisma/client";
import prisma from "../db.server";
import { sendSlackNotification } from "./notifications.server";
import { startOfDay, shiftDays } from "../utils/dates.server.js";

const { ReportFrequency } = pkg;

const DEFAULT_ROAS_THRESHOLD = 1.0;
const NET_PROFIT_DROP_PERCENT = 0.3;

export async function evaluatePerformanceAlerts({ store, thresholds = {} }) {
  if (!store?.id || !store.merchantId) return [];
  const today = startOfDay(new Date());
  const yesterday = shiftDays(today, -1);

  const [todayMetric, yesterdayMetric] = await Promise.all([
    prisma.dailyMetric.findFirst({
      where: {
        storeId: store.id,
        channel: "TOTAL",
        productSku: null,
        date: today,
      },
    }),
    prisma.dailyMetric.findFirst({
      where: {
        storeId: store.id,
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

  if (!flags.length) {
    return [];
  }

  const text = buildAlertMessage(store, flags);

  await sendSlackNotification({
    merchantId: store.merchantId,
    text,
    payload: buildSlackBlockPayload(store.shopDomain, flags),
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

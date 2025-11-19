import { createScopedLogger, serializeError } from "../utils/logger.server.js";

let metricsLogger = createScopedLogger({ service: "metrics" });

function coerceDuration(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value);
}

function cleanMeta(meta) {
  const result = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result;
}

export function setMetricsLoggerForTests(testLogger) {
  metricsLogger =
    testLogger ||
    createScopedLogger({ service: "metrics", test: true });
}

export function resetMetricsLoggerForTests() {
  metricsLogger = createScopedLogger({ service: "metrics" });
}

export function recordOrderProcessing({
  storeId,
  merchantId,
  shopifyOrderId,
  status,
  durationMs,
  channel,
  totals = {},
  error,
}) {
  const {
    revenue,
    grossProfit,
    netProfit,
    refundCount,
    missingSkuCostCount,
  } = totals;
  const meta = cleanMeta({
    storeId,
    merchantId,
    orderId: shopifyOrderId,
    status: status || "unknown",
    durationMs: coerceDuration(durationMs),
    channel,
    revenue,
    grossProfit,
    netProfit,
    refundCount,
    missing_sku_cost_count: missingSkuCostCount,
  });

  if (error) {
    meta.error = serializeError(error);
  }

  const level = status === "success" ? "info" : "error";
  metricsLogger[level]("order.processed", meta);
}

export function recordPlanLimitError({
  merchantId,
  storeId,
  limit,
  usage,
  source,
}) {
  const meta = cleanMeta({ merchantId, storeId, limit, usage, source });
  metricsLogger.warn("plan.limit_exceeded", meta);
}

export function recordReportScheduleExecution({
  scheduleId,
  merchantId,
  storeId,
  channel,
  status,
  durationMs,
  error,
}) {
  const meta = cleanMeta({
    scheduleId,
    merchantId,
    storeId,
    channel,
    status: status || "unknown",
    durationMs: coerceDuration(durationMs),
  });

  if (error) {
    meta.error = serializeError(error);
  }

  const level = status === "success" ? "info" : status === "delivery_failed" ? "warn" : "error";
  metricsLogger[level]("report_schedule.run", meta);
}

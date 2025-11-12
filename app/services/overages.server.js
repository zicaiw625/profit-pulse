import { sendSlackNotification } from "./notifications.server";

export async function notifyPlanOverage({ merchantId, limit, usage, metric = "orders" }) {
  if (!merchantId) return;
  const limitLabel = metric === "orders" ? "订单" : metric;
  const message = `🚨 Plan limit reached for Profit Pulse workspace (${limitLabel}): ${usage} / ${limit}.`;
  await sendSlackNotification({
    merchantId,
    text: message,
  });
}

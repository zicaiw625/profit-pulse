import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getCustomReportData } from "../services/reports.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const url = new URL(request.url);
  const metricsParam = url.searchParams.get("metrics");
  const metricList = metricsParam
    ? metricsParam.split(",").map((item) => item.trim()).filter(Boolean)
    : null;
  const formula = url.searchParams.get("formula") ?? undefined;
  const formulaLabel = url.searchParams.get("formulaLabel") ?? undefined;

  const limit = Number(url.searchParams.get("limit")) || 25;
  const payload = await getCustomReportData({
    storeId: store.id,
    dimension: url.searchParams.get("dimension") ?? undefined,
    metrics: metricList ?? undefined,
    start: url.searchParams.get("start") ?? undefined,
    end: url.searchParams.get("end") ?? undefined,
    limit,
    formula,
    formulaLabel,
  });

  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
};

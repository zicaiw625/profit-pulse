import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import {
  getReconciliationSnapshot,
  runReconciliationChecks,
} from "../services/reconciliation.server";
import { formatCurrency } from "../utils/formatting";
import { RECONCILIATION_RULE_DEFAULTS } from "../config/reconciliation.js";
import { useLocale } from "../hooks/useLocale";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  await runReconciliationChecks({ storeId: store.id });
  const snapshot = await getReconciliationSnapshot({
    storeId: store.id,
  });
  return {
    snapshot,
    rules: RECONCILIATION_RULE_DEFAULTS,
    currency: store.currency ?? "USD",
  };
};

const RECONCILIATION_COPY = {
  en: {
    ruleOfThumb: (paymentPercent, paymentAmount, adsMultiple, spendThreshold) =>
      `If Shopify vs. payment revenue differs by more than ${paymentPercent}% or ${paymentAmount} on a given day, we flag a payment anomaly. ` +
      `If Meta conversions exceed Shopify orders by ${adsMultiple}x, or spend is above ${spendThreshold} with zero conversions, we flag an ads anomaly.`,
    pageTitle: "Reconciliation workspace",
    sections: {
      summary: "Summary",
      rule: "Rule of thumb",
      issues: "Open issues",
    },
    tableHeaders: {
      id: "ID",
      type: "Type",
      channel: "Channel",
      order: "Order",
      details: "Details",
      detected: "Detected",
    },
    summaryIssuesLabel: "open issues",
    upcoming: {
      heading: "Upcoming automation",
      items: [
        "Auto-close resolved payout diffs",
        "Email digest of large discrepancies",
        "Sync adjustments to accounting export",
      ],
    },
  },
  zh: {
    ruleOfThumb: (paymentPercent, paymentAmount, adsMultiple, spendThreshold) =>
      `当某天 Shopify 与支付渠道营收差异超过 ${paymentPercent}% 或 ${paymentAmount} 时，我们会标记为「支付异常」；` +
      `当 Meta 转化数高于 Shopify 订单 ${adsMultiple} 倍，或花费超过 ${spendThreshold} 但 0 转化时，会标记为「广告异常」。`,
    pageTitle: "对账工作台",
    sections: {
      summary: "概览",
      rule: "经验阈值",
      issues: "待处理问题",
    },
    tableHeaders: {
      id: "编号",
      type: "类型",
      channel: "渠道",
      order: "订单",
      details: "详情",
      detected: "发现时间",
    },
    summaryIssuesLabel: "个待处理问题",
    upcoming: {
      heading: "即将上线的自动化",
      items: [
        "自动关闭已解决的付款差异",
        "推送重大差异的邮件摘要",
        "将调整同步到会计导出",
      ],
    },
  },
};

export default function ReconciliationPage() {
  const { snapshot, rules, currency } = useLoaderData();
  const { lang } = useLocale();
  const copy = RECONCILIATION_COPY[lang] ?? RECONCILIATION_COPY.en;
  const paymentPercent = (rules.payment.percentDelta * 100).toFixed(1);
  const paymentAmount = formatCurrency(rules.payment.amountDelta, currency);
  const adsMultiple = rules.ads.conversionMultiple.toFixed(1);
  const spendThreshold = formatCurrency(rules.ads.minSpendWithoutConversions, currency);

  return (
    <s-page heading={copy.pageTitle}>
      <s-section heading={copy.sections.summary}>
        <s-stack direction="inline" gap="base" wrap>
          {snapshot.summary.map((item) => (
            <s-card key={item.title} padding="base">
              <s-heading>{item.title}</s-heading>
              <s-text variation="subdued">
                {item.issues} {copy.summaryIssuesLabel} · Δ {formatCurrency(item.amountDelta)}
              </s-text>
              <s-badge tone={item.status === "attention" ? "critical" : "warning"}>
                {item.status}
              </s-badge>
            </s-card>
          ))}
        </s-stack>
      </s-section>

      <s-section heading={copy.sections.rule}>
        <s-card padding="base">
          <s-text variation="subdued">
            {copy.ruleOfThumb(paymentPercent, paymentAmount, adsMultiple, spendThreshold)}
          </s-text>
        </s-card>
      </s-section>

      <s-section heading={copy.sections.issues}>
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">{copy.tableHeaders.id}</th>
                <th align="left">{copy.tableHeaders.type}</th>
                <th align="left">{copy.tableHeaders.channel}</th>
                <th align="left">{copy.tableHeaders.order}</th>
                <th align="left">{copy.tableHeaders.details}</th>
                <th align="left">{copy.tableHeaders.detected}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.issues.map((issue) => (
                <tr key={issue.id}>
                  <td>{issue.id}</td>
                  <td>{issue.type}</td>
                  <td>{issue.channel}</td>
                  <td>{issue.orderNumber || "—"}</td>
                  <td>{issue.description}</td>
                  <td>{new Date(issue.detectedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section slot="aside" heading={copy.upcoming.heading}>
        <s-unordered-list>
          {copy.upcoming.items.map((item) => (
            <s-list-item key={item}>{item}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

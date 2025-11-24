import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { useLocale } from "../hooks/useLocale";
import { UNINSTALL_RETENTION_DAYS } from "../constants/retention.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const TERMS_COPY = {
  en: {
    heading: "Terms of use",
    subtitle: "By using Profit Pulse you agree to the following",
    introTitle: "Please read and understand these terms before installing.",
    introBody:
      "Using this app means you consent to our connection with Shopify, advertising, and payment platforms, and to transparently displaying profit, refunds, and reconciliation results.",
    sections: [
      {
        title: "Scope of service",
        body:
          "Profit Pulse provides aggregated order/ads/payment data, cost templates, profit engine, reports, and reconciliation alerts, supporting a unified view for multiple stores and ad accounts.",
      },
      {
        title: "Liability & availability",
        body:
          "If metrics differ due to data latency, lost webhooks, or third-party rate limits, we will flag anomalies on the reconciliation screen but cannot be responsible for decisions merchants make.",
      },
      {
        title: "Data retention",
        body:
          `Merchants can uninstall anytime via Shopify admin > Apps > Profit Pulse; after disconnecting we stop syncing and will remove associated records within ${UNINSTALL_RETENTION_DAYS} days.`,
      },
      {
        title: "Intellectual property",
        body:
          "Profit Pulse and its dashboards, reports, alerts, and export formats are original content and must not be copied for commercial competition without authorization.",
      },
    ],
  },
  zh: {
    heading: "使用条款",
    subtitle: "使用 Profit Pulse 即表示您同意以下内容",
    introTitle: "请务必在安装前阅读并理解本条款。",
    introBody:
      "使用本应用即表示您同意我们对接 Shopify、广告与支付平台，并以透明方式展示利润、退款与对账结果。",
    sections: [
      {
        title: "服务范围",
        body:
          "Profit Pulse 提供订单/广告/支付数据汇总、成本模板、利润引擎、报表和对账通知，支持多个店铺与广告账户的统一视图。",
      },
      {
        title: "责任与可用性",
        body:
          "因数据源延迟、Webhooks 丢失或第三方 API 限流导致指标不一致的情况下，我们会在对账界面标注异常，但无法对商家产生的决策结果负责。",
      },
      {
        title: "数据保留",
        body:
          `商家可以随时通过 Shopify 商店 > 应用 > Profit Pulse 选择注销，删除连接后我们会停止同步，并会在卸载后 ${UNINSTALL_RETENTION_DAYS} 天内清除关联记录。`,
      },
      {
        title: "知识产权",
        body:
          "Profit Pulse 及其仪表盘、报表、警报和导出格式均为本公司原创内容，未经授权不得复制用于商业竞争。",
      },
    ],
  },
};

export default function TermsPage() {
  const { lang } = useLocale();
  const copy = TERMS_COPY[lang] ?? TERMS_COPY.en;

  return (
    <s-page heading={copy.heading} subtitle={copy.subtitle}>
      <s-stack direction="block" gap="loose">
        <s-card padding="base" tone="primary">
          <s-heading>{copy.introTitle}</s-heading>
          <s-text variation="subdued">{copy.introBody}</s-text>
        </s-card>
        {copy.sections.map((section) => (
          <s-section key={section.title} heading={section.title}>
            <s-text variation="subdued">{section.body}</s-text>
          </s-section>
        ))}
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

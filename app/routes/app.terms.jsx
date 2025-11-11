import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const TERMS_SECTIONS = [
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
      "商家可以随时通过 Shopify 商店 > 应用 > Profit Pulse 选择注销，删除连接后我们会停止同步并在合理时间内清除关联记录。",
  },
  {
    title: "知识产权",
    body:
      "Profit Pulse 及其仪表盘、报表、警报和导出格式均为本公司原创内容，未经授权不得复制用于商业竞争。",
  },
];

export default function TermsPage() {
  return (
    <s-page heading="使用条款" subtitle="使用 Profit Pulse 即表示您同意以下内容">
      <s-stack direction="block" gap="loose">
        <s-card padding="base" tone="primary">
          <s-heading>请务必在安装前阅读并理解本条款。</s-heading>
          <s-text variation="subdued">
            使用本应用即表示您同意我们对接 Shopify、广告与支付平台，并以透明方式展示利润、退款与对账结果。
          </s-text>
        </s-card>
        {TERMS_SECTIONS.map((section) => (
          <s-section key={section.title} heading={section.title}>
            <s-text variation="subdued">{section.body}</s-text>
          </s-section>
        ))}
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

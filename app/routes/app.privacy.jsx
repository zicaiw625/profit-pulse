import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const POLICY_SECTIONS = [
  {
    title: "所收集的数据",
    body: [
      "我们读取 Shopify 订单、退款、支付、产品、客户等数据，用于计算成本、利润和对账指标，并存储少量必要的元数据（SKU、渠道、时间戳等）。",
      "广告平台连接后，我们会同步花费、转化、广告名称等信息来把花费分配到订单并供仪表盘使用。",
    ],
  },
  {
    title: "数据使用与加密",
    body: [
      "所有保存的敏感令牌与凭证经 JSON 加密并存储在受 Prisma 管理的数据库中，只能在后台服务中读取。",
      "数据传输始终使用 HTTPS，后台与 Shopify/广告平台的 API 通信由官方 SDK 处理。",
    ],
  },
  {
    title: "访问控制与权限",
    body: [
      "账户所有者可以邀请 Finance/Marketing 团队角色并分别允许有限操作（上传成本、同步广告、生成报表等）。",
      "Shopify Session 由 Shopify App Bridge 管理，会在用户登出、令牌失效或店铺移除时过期。",
    ],
  },
  {
    title: "保留与删除",
    body: [
      "商家可随时通过 Shopify 应用设置撤销权限，应用将停止同步新数据并保留最后一次汇总的日志。",
      "若需强制删除数据（例如应对 GDPR 请求），请联系支持，我们可以清空与商户关联的订单、成本、固定成本与通知记录。",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <s-page heading="隐私政策" subtitle="我们如何处理商家的数据">
      <s-stack direction="block" gap="loose">
        <s-card padding="base" tone="primary">
          <s-heading>
            Profit Pulse 是为 Shopify 商家构建的数据分析与对账平台，我们坚守安全第一的原则。
          </s-heading>
          <s-text variation="subdued">
            本政策以简洁语言说明我们为何收集哪些数据、如何保护它们，以及商家如何控制自己的信息。
          </s-text>
        </s-card>
        {POLICY_SECTIONS.map((section) => (
          <s-section key={section.title} heading={section.title}>
            <s-stack direction="block" gap="base">
              {section.body.map((paragraph) => (
                <s-text key={paragraph} variation="subdued">
                  {paragraph}
                </s-text>
              ))}
            </s-stack>
          </s-section>
        ))}
      </s-stack>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);

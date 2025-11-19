export const HELP_ONBOARDING_ITEMS = [
  "确认 Shopify OAuth 安装无误，并留出时间让最近 60 天订单同步完成。",
  "在设置中连接 Meta Ads 账户，把花费、点击、转化拉入仪表盘。",
  "上传或编辑 SKU 成本、支付手续费模板，保证净利润计算准确。",
  "设置主记账货币及汇率模式，确保多币种订单可统一统计。",
];

export const HELP_METRIC_DEFINITIONS = [
  {
    title: "营收与成本",
    description:
      "营收 = 商品金额 – 折扣 + 运费 + 税费。COGS 包含 SKU 成本，支付模板覆盖 Shopify Payments / PayPal 手续费，平台抽成在可变成本模板内配置。",
  },
  {
    title: "净利润与 ROAS",
    description:
      "净利润 = 营收 – 直接成本 – 广告花费；净利率 = 净利润 / 营收。ROAS 关注营收 / 广告花费，默认数据来自 Meta Ads 账户。",
  },
  {
    title: "退款与对账",
    description:
      "退款率 = 退款订单 ÷ 总订单。对账模块会比较 Shopify ↔ 支付网关、Shopify ↔ 广告平台的日级数据，标记差异便于查阅。",
  },
];

export const HELP_SYNC_ITEMS = [
  "Shopify 订单、行项目、退款会在安装后拉取最近 60 天，并通过 webhook/轮询保持 10-15 分钟一致。",
  "Meta Ads 每日同步最近 60 天花费与转化；若订单号相同则直接归因，重复归因为平均分摊。",
  "Shopify Payments 是默认的手续费来源，PayPal 可以通过费率模板估算；两者都参与对账比较。",
  "如需补历史数据，可在设置页手动触发同步，或导入成本 CSV 以提升准确度。",
];

export const HELP_LINKS = [
  {
    title: "产品定位 & 路线",
    description: "查看 docs/feature-map.md 了解当前 V1 范围及后续迭代计划。",
  },
  {
    title: "手动成本导入",
    description: "在 设置 > 成本配置 中上传 CSV，字段包含 SKU, Cost, Currency。",
    link: { href: "/app/settings", label: "前往设置" },
  },
  {
    title: "返回仪表盘",
    description: "需要快速查看近 7/30 天表现时，可随时回到首页仪表盘。",
    link: { href: "/app", label: "仪表盘" },
  },
];

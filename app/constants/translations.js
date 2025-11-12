export const TRANSLATION_KEYS = {
  ONBOARDING_TITLE: "onboarding.title",
  ONBOARDING_DESC: "onboarding.desc",
  STEP_CONNECT_STORE: "onboarding.step.connect",
  STEP_IMPORT_COSTS: "onboarding.step.costs",
  STEP_LINK_ADS: "onboarding.step.ads",
  STEP_SETUP_ALERTS: "onboarding.step.alerts",
};

export const TRANSLATIONS = {
  en: {
    [TRANSLATION_KEYS.ONBOARDING_TITLE]: "Quick start onboarding",
    [TRANSLATION_KEYS.ONBOARDING_DESC]:
      "Walk through the essential setup to start seeing profit insights across stores, ads, and payments.",
    [TRANSLATION_KEYS.STEP_CONNECT_STORE]:
      "1. Connect Shopify store and verify OAuth permissions for orders, refunds, and customers.",
    [TRANSLATION_KEYS.STEP_IMPORT_COSTS]:
      "2. Upload SKU cost CSV or seed demo templates to make COGS and shipping estimates accurate.",
    [TRANSLATION_KEYS.STEP_LINK_ADS]:
      "3. Connect Meta/Google Ads to feed spend into the attribution pipeline and track ROAS.",
    [TRANSLATION_KEYS.STEP_SETUP_ALERTS]:
      "4. Save a Slack/Teams webhook, set alerts and scheduled digests to monitor anomalies.",
  },
  zh: {
    [TRANSLATION_KEYS.ONBOARDING_TITLE]: "快速上手引导",
    [TRANSLATION_KEYS.ONBOARDING_DESC]:
      "按步骤完成 Shopify/广告/成本/通知配置，立即看到利润仪表盘与健康报警。",
    [TRANSLATION_KEYS.STEP_CONNECT_STORE]:
      "1. 连接 Shopify 店铺，授权订单、退款与客户数据。",
    [TRANSLATION_KEYS.STEP_IMPORT_COSTS]:
      "2. 上传 SKU 成本 CSV 或使用演示模板，确保 COGS 与运费估算准确。",
    [TRANSLATION_KEYS.STEP_LINK_ADS]:
      "3. 连接 Meta/Google 广告，花费数据即时进入归因与 ROAS 追踪。",
    [TRANSLATION_KEYS.STEP_SETUP_ALERTS]:
      "4. 保存 Slack/Teams Webhook，配置告警与定时报表，随时掌握异常。",
  },
};

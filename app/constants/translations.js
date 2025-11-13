export const TRANSLATION_KEYS = {
  ONBOARDING_TITLE: "onboarding.title",
  ONBOARDING_DESC: "onboarding.desc",
  STEP_CONNECT_STORE: "onboarding.step.connect",
  STEP_IMPORT_COSTS: "onboarding.step.costs",
  STEP_LINK_ADS: "onboarding.step.ads",
  STEP_SETUP_ALERTS: "onboarding.step.alerts",
  REPORTS_BUILDER_HEADING: "reports.builder.heading",
  REPORTS_BUILDER_DESC: "reports.builder.description",
  REPORTS_DIMENSION_LABEL: "reports.builder.dimensionLabel",
  REPORTS_METRICS_LABEL: "reports.builder.metricsLabel",
  REPORTS_DATE_RANGE_LABEL: "reports.builder.dateRangeLabel",
  REPORTS_RUN_REPORT: "reports.builder.runButton",
  REPORTS_NO_DATA: "reports.builder.noData",
  REPORTS_LANG_LABEL: "reports.language.label",
  REPORTS_DIMENSION_CHANNEL: "reports.dimension.channel",
  REPORTS_DIMENSION_PRODUCT: "reports.dimension.product",
  REPORTS_DIMENSION_DATE: "reports.dimension.date",
  REPORTS_DIMENSION_COUNTRY: "reports.dimension.country",
  REPORTS_DIMENSION_CUSTOMER: "reports.dimension.customer",
  REPORTS_METRIC_REVENUE: "reports.metric.revenue",
  REPORTS_METRIC_NET_PROFIT: "reports.metric.netProfit",
  REPORTS_METRIC_AD_SPEND: "reports.metric.adSpend",
  REPORTS_METRIC_ORDERS: "reports.metric.orders",
  REPORTS_ACCOUNTING_HEADING: "reports.accounting.heading",
  REPORTS_ACCOUNTING_DESC: "reports.accounting.description",
  REPORTS_ACCOUNTING_START: "reports.accounting.start",
  REPORTS_ACCOUNTING_END: "reports.accounting.end",
  REPORTS_ACCOUNTING_DOWNLOAD: "reports.accounting.download",
  REPORTS_TAX_TEMPLATE: "reports.taxTemplate.heading",
  REPORTS_TAX_TEMPLATE_DESC: "reports.taxTemplate.description",
  REPORTS_TAX_TEMPLATE_DOWNLOAD: "reports.taxTemplate.download",
  REPORTS_EXPORT_CUSTOM: "reports.builder.exportCustom",
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
    [TRANSLATION_KEYS.REPORTS_BUILDER_HEADING]: "Advanced report builder",
    [TRANSLATION_KEYS.REPORTS_BUILDER_DESC]:
      "Choose a dimension and metrics to slice revenue, profit, and spend across time.",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_LABEL]: "Dimension",
    [TRANSLATION_KEYS.REPORTS_METRICS_LABEL]: "Metrics",
    [TRANSLATION_KEYS.REPORTS_DATE_RANGE_LABEL]: "Date range",
    [TRANSLATION_KEYS.REPORTS_RUN_REPORT]: "Generate report",
    [TRANSLATION_KEYS.REPORTS_NO_DATA]: "No data matches the selected configuration.",
    [TRANSLATION_KEYS.REPORTS_LANG_LABEL]: "Display language",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_CHANNEL]: "Channel",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_PRODUCT]: "Product SKU",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_DATE]: "Date",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_COUNTRY]: "Country / Region",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_CUSTOMER]: "Customer",
    [TRANSLATION_KEYS.REPORTS_METRIC_REVENUE]: "Revenue",
    [TRANSLATION_KEYS.REPORTS_METRIC_NET_PROFIT]: "Net profit",
    [TRANSLATION_KEYS.REPORTS_METRIC_AD_SPEND]: "Ad spend",
    [TRANSLATION_KEYS.REPORTS_METRIC_ORDERS]: "Orders",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_HEADING]:
      "Detailed accounting export",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_DESC]:
      "Pick a date range to export granular daily accounting rows.",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_START]: "Start date",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_END]: "End date",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_DOWNLOAD]: "Download detail CSV",
    [TRANSLATION_KEYS.REPORTS_TAX_TEMPLATE]: "Tax template export",
    [TRANSLATION_KEYS.REPORTS_TAX_TEMPLATE_DESC]:
      "Include your tax rate templates in CSV form for accountants or tax advisors.",
    [TRANSLATION_KEYS.REPORTS_TAX_TEMPLATE_DOWNLOAD]: "Download tax template",
    [TRANSLATION_KEYS.REPORTS_EXPORT_CUSTOM]: "Download custom CSV",
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
    [TRANSLATION_KEYS.REPORTS_BUILDER_HEADING]: "高级报表构建器",
    [TRANSLATION_KEYS.REPORTS_BUILDER_DESC]:
      "选择维度与指标，按时间段切割营收、利润和花费。",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_LABEL]: "维度",
    [TRANSLATION_KEYS.REPORTS_METRICS_LABEL]: "指标",
    [TRANSLATION_KEYS.REPORTS_DATE_RANGE_LABEL]: "日期区间",
    [TRANSLATION_KEYS.REPORTS_RUN_REPORT]: "生成报表",
    [TRANSLATION_KEYS.REPORTS_NO_DATA]: "未找到符合条件的数据。",
    [TRANSLATION_KEYS.REPORTS_LANG_LABEL]: "界面语言",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_CHANNEL]: "渠道",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_PRODUCT]: "商品 SKU",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_DATE]: "日期",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_COUNTRY]: "国家 / 地区",
    [TRANSLATION_KEYS.REPORTS_DIMENSION_CUSTOMER]: "客户",
    [TRANSLATION_KEYS.REPORTS_METRIC_REVENUE]: "营收",
    [TRANSLATION_KEYS.REPORTS_METRIC_NET_PROFIT]: "净利润",
    [TRANSLATION_KEYS.REPORTS_METRIC_AD_SPEND]: "广告花费",
    [TRANSLATION_KEYS.REPORTS_METRIC_ORDERS]: "订单",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_HEADING]: "会计明细导出",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_DESC]:
      "选择日期范围，导出每日会计账目明细。",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_START]: "起始日期",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_END]: "结束日期",
    [TRANSLATION_KEYS.REPORTS_ACCOUNTING_DOWNLOAD]: "下载明细 CSV",
    [TRANSLATION_KEYS.REPORTS_TAX_TEMPLATE]: "税率模板导出",
    [TRANSLATION_KEYS.REPORTS_TAX_TEMPLATE_DESC]:
      "将税率模板以 CSV 形式导出，供会计或税务团队使用。",
    [TRANSLATION_KEYS.REPORTS_TAX_TEMPLATE_DOWNLOAD]: "下载税率模板",
    [TRANSLATION_KEYS.REPORTS_EXPORT_CUSTOM]: "下载自定义 CSV",
  },
};

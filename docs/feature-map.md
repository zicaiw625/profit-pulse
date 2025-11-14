# Feature coverage matrix

本文将当前仓库的功能实现与最初的“Shopify 利润分析与对账”功能清单（核心 / 进阶 / 高级）进行对照，按模块列出已建成的能力、参考位置，以及还需补充的重点项。

## 1. 账户与店铺管理
- 🚩 Shopify OAuth 安装、计费：通过 `@shopify/shopify-app-react-router` 的认证+计费配置完成，主配置在 `app/shopify.server.js:1` 和 `app/config/billing.js:1`。
- 🚩 多商店关联、默认计划：`ensureMerchantAndStore` 在首次安装时创建 `MerchantAccount` 与 `Store`（`app/models/store.server.js:8`），自带默认计划限额；最新逻辑会复用同一 ownerEmail 的 merchant，免去了重复创建。
- ⭐ 多店共享提示：Settings 页面增设“多店铺聚合”说明与 free tier 文案，提醒商家通过同一邮箱安装即可共享工作区（`app/routes/app.settings.jsx:1013`）。
- ⭐ 团队成员邀请与权限：`app/routes/app.settings.jsx:45` 定义角色/意图权限，`team.server.js:1` 提供邀请、更新、删除接口，Settings 页面在 `app/routes/app.settings.jsx:1451` 展示成员表与操作按钮。
- ⭐ 角色访问控制：`app/routes/app.settings.jsx:73` 在后端处理 `ensureRoleForIntent` 并在 UI 层通过 `canPerformIntent`/`permissionDescription` 控制按钮信息。

## 2. 订阅与计费
- 🚩 免费层/Basic/Pro plan：`app/config/billing.js:1` 现在新增 FREE plan，并在 `store.server.js:8` 默认赋予免费计划；只有 Basic/Pro 在 `BILLING_CONFIG` 中有 billingKey 供 Shopify 计费（`plan-limits.server.js:1` 仍负责用量限制）。
- ✅ 超额计费：Basic/Pro 计划在 `app/config/billing.js` 中加入 Usage line item 与 overage 费率，`plan-limits.server.js` 与 `store.server.js` 在超额时写入 `PlanOverageRecord` 并调用 Shopify Usage Record（`app/services/overages.server.js`）。
- ⭐ Overage 通知：当 `PlanLimitError` 触发时，`app/services/profit-engine.server.js:12` 会调用 `overages.server.js:1` 通过 Slack 提醒团队，Settings 亦会在 free tier 下展示限额提示（`app/routes/app.settings.jsx:1013`）。

## 3. 数据源集成
- 🚩 Shopify 订单/退款：`app/routes/webhooks.orders.create.jsx:1` 和 `app/routes/webhooks.orders.updated.jsx:1` 接受 webhook，将 payload 交给 `processShopifyOrder`；退款 webhook 触发 `syncOrderById`（`app/routes/webhooks.refunds.create.jsx:1`）。
- 🚩 增量同步 & 手动拉取：`app/services/sync/shopify-orders.server.js:1` 提供手动同步 API，`app/routes/app.settings.jsx:700` 按钮触发 `sync-orders` 意图。
- 🚩 广告平台 Meta/Google：`app/services/connectors/meta-ads.server.js:1` 和 `google-ads.server.js:1` 拉取 spend/conversion，`syncAdProvider` 在 `app/services/sync/ad-spend.server.js:1` 写入 `AdSpendRecord` 并累计到 `dailyMetric`。
- 🚩 Amazon Ads / Snapchat Ads：新增 `app/services/connectors/amazon-ads.server.js:1` 与 `snapchat-ads.server.js:1` 连接器，和 UI/计划支持在 Settings 里登记 credential（`app/routes/app.settings.jsx:1661`）。
- ⭐ 广告扩展准备：TikTok/Bing provider 已有真实 connector（`app/services/connectors/tiktok-ads.server.js:1`, `bing-ads.server.js:1`），只要提供访问令牌/开发者令牌，即可向对应 API 获取 Campaign/Ad Set/Ad 级 spend 与转化数据，Settings 页也继续支持凭证输入。
- 🚩 支付与手续费：`app/services/sync/payment-payouts.server.js:1` 同步 Shopify Payments，`app/services/imports/payment-payouts.server.js:1` 支持 PayPal/Stripe CSV；`app/services/notifications.server.js:1` 支持 Slack 通知提醒。
- ⭐ 支付扩展：`importPaymentPayoutCsv` 接收 provider 参数，可导入 Stripe 及 Klarna 结算数据，Settings 中的上传表单也包含对应选项。
- ⭐ 集成状态与凭证管理：`app/services/credentials.server.js:1` 和 `app/services/integrations.server.js:1` 汇总已连接的广告/支付来源与上次同步时间。

## 4. 成本配置
- 🚩 SKU 级成本 + 模板：`app/services/costs.server.js:6` 查看/更新 SKU 成本，`seedDemoCostConfiguration` 生成示例模板，`importSkuCostsFromCsv` 支持批量导入（`app/routes/app.settings.jsx:300` 提供上传入口）。
- 🚩 可变成本模板：`processShopifyOrder` 在 `app/services/profit-engine.server.js:1` 调用 `getVariableCostTemplates`，按渠道/支付方式加成，并用 `orderCost` 记录（`app/services/profit-engine.server.js:130`）。
- ⭐ 固定成本：`app/services/fixed-costs.server.js:1` 提供 CRUD 和区间分摊，`app/services/dashboard.server.js:1`、`reports.server.js:1` 在汇总卡中使用 `getFixedCostTotal`。

## 5. 利润计算引擎
- 🚩 实时订单分析：`processShopifyOrder` 聚合 revenue/COGS/fees/ad spend/退款，生成 `dailyMetric` 聚合（`app/services/profit-engine.server.js:1`）。
- 🚩 退款分配与 SKU 处理：`syncRefundRecords` 保存退款明细并在 `dailyMetric` 中按 SKU 分摊（`app/services/profit-engine.server.js:200`）。
- ⭐ 货币转换：`exchange-rates.server.js:1` 提供汇率刷新与查询，Dashboard/Reports 按主币种转换。
- ⭐ 归因分配：新的设置页表单允许调整各广告平台的权重与归因窗口，`profit-engine.server.js` 会根据规则把每日渠道 ad spend 分配到订单并写入 `OrderAttribution`（`app/services/attribution.server.js:1`）。
- ⭐ 多触点归因：`app/services/attribution.server.js:1` 现支持每个 provider 配置首/末触点权重，利润引擎在 `app/services/profit-engine.server.js:876` 按比例平摊花费到每个触点，`app/routes/app.settings.jsx:1592` UI 显示多个触点输入。
- ⭐ 自动化告警：调度任务在发送报表前还会运行 `alert-triggers.server.js:1`，检测日净利、ROAS 变化并通过 Slack/Teams (payload 块) 通知团队（`app/services/report-schedules-runner.server.js:17`、`app/services/notifications.server.js:1`）。

## 6. 报表与仪表盘
- 🚩 仪表盘概览：`app/routes/app._index.jsx:1` 调用 `getDashboardOverview`（`app/services/dashboard.server.js:1`）渲染 KPI 卡片、趋势线与成本构成。
- 🚩 多维报表及导出：`app/routes/app.reports.jsx:1` 展示渠道/产品/广告，`app/routes/app.reports.export.$type.jsx:1` 支持 Channels/Products/Net profit/Ads CSV 输出，`app/services/reports.server.js:1` 计算 MER/NPAS/产品排行。
- 🚩 退款分析：`app/routes/app.refunds.jsx:1` + `app/services/refunds.server.js:1` 提供退款趋势、产品/理由细分、详细导出。
- ⭐ Dashboard alerts：`app/services/alerts.server.js:1` 每日检测净利/退款异常，并通过 Slack 告警（`app/services/notifications.server.js:1`）。
- ⭐ 高级报表构建器：`app/routes/app.reports.jsx:1` 新增维度/指标选择、`app/routes/app.reports.custom.jsx:1` 提供定制数据、`app/services/reports.server.js:1` 支持 channel/product/date 维度及多指标；输出可导出到 `app/routes/app.reports.export.$type.jsx:1` 的 custom CSV。
- ⭐ 会计明细与税率模板导出：`app/routes/app.reports.export.$type.jsx:1` 新增 `accounting-detailed` 与 `tax-template` 类型，`app/services/accounting.server.js:1` 提供每日账目，`app/services/tax-rates.server.js:1` 提供模板数据。

## 7. 对账与异常检测
- 🚩 Shopify vs 支付/广告对账：`app/services/reconciliation.server.js:1` 每次访问时执行差异检测并写入 `ReconciliationIssue`，`app/routes/app.reconciliation.jsx:1` 展示问题摘要与细节。
- ⭐ 自动通知：`reconciliation.server.js:1` 在创建 issue 后调用 `sendSlackNotification`，并在 Dashboard 侧栏提醒。

## 8. 自动化与通知
- 🚩 定时报表：`app/services/report-schedules.server.js:1` 管理计划，`app/services/report-schedules-runner.server.js:1` 拉取概览并通过 `email.server.js:1` 发送摘要。
- ⭐ 阈值告警（Slack）：`app/services/alerts.server.js:1` 检测净利/退款，`app/routes/app.settings.jsx:870` 提供 Slack 链接与测试按钮。
- ⭐ 团队通知：`notifications.server.js:1` 可添加或删除 Slack Webhook，Settings 中提供 UI。
- ⭐ 多通道通知：`app/services/notifications.server.js:1` 现在支持 Slack + Teams/Webhook 类型，`app/routes/app.settings.jsx:920` 可选择通道类型并管理通知渠道。

## 9. 体验与帮助
- 🚩 设置页引导与 sandbox：`app/routes/app.settings.jsx:1670` 提供“处理 demo 订单”按钮，`INTENT_LABELS`/`ROLE_PERMISSIONS` 在页面顶部就绪。
- ⭐ 新增 Help center：`app/routes/app.help.jsx:1` 使用 `constants/helpContent.js:1`，在导航中通过 `/app/help` 暴露，解释指标与 sync 习惯。
- ⭐ 术语解释：Dashboard/Reports 中卡片下方的说明（`app/routes/app._index.jsx:62`等）提供简要描述。
- ⭐ 新手引导：`/app/onboarding` 页面利用轻量翻译（中英文）提供 4 步指南，并在帮助页中链接，让团队快速完成数据连接。
- ⭐ 多语言支持：`app/routes/app.reports.jsx:1` 的新报表页提供中英文语言开关、`app/constants/translations.js:1` 新增报表相关文案，所有新表单/导出只需切换语言即可使用。

## 10. 系统与合规
- 🚩 数据建模与会话：Prisma schema 包含 `Session`、`MerchantAccount`、`Subscription`，凭证在 `credentials.server.js:1` 使用加密 JSON 存储。
- ⭐ 安全/日志：暂未实现明确的访问日志或导出审计，需要后续补齐流水线。
- 🚩 隐私 / 使用条款页面：`app/routes/app.privacy.jsx:1` 与 `app/routes/app.terms.jsx:1` 在 Help 页面新增 `法律与合规` 区块可访问。

## 待补充/下一步
1. ⭐ 试用/免费层：尚需补齐试用倒计时 UI 与免费层可用功能提示，当前仅在 Settings 文案中提及。
2. ⭐ 广告与支付外延（TikTok/Bing/Klarna/Stripe 等）尚未接入；也缺少自定义权重的归因规则与多广告触达分配。
3. ⭐ 高级报表构建器、会计导出（科目化）、多语言、税率模板、合规页（隐私政策）等仍在规划中。

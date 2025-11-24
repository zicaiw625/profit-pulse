# Profit Pulse 上架前优化清单（建议逐项勾选）

## 一、环境变量与配置安全

- [ ] 删除或禁用硬编码默认密钥
  - [ ] 在 `app/shopify.server.js` 中移除：
    - `SHOPIFY_API_KEY || "test-key"`
    - `SHOPIFY_API_SECRET || "test-secret"`
    - `SHOPIFY_APP_URL || "http://localhost"`
  - [ ] 改为：生产环境必须配置对应环境变量，否则启动报错退出。
- [ ] 严格区分开发 / 生产配置
  - [ ] 使用 `NODE_ENV` 或自定义 `APP_ENV` 区分 `development` / `production`。
  - [ ] 本地开发可以保留 fallback，生产环境一律禁止 fallback。
- [ ] 校验必要环境变量
  - [ ] 在应用启动时，对以下变量做存在性检查：`SHOPIFY_API_KEY`、`SHOPIFY_API_SECRET`、`SHOPIFY_APP_URL`、`SCOPES`、`DATABASE_URL`、加密相关 key（如 AES 密钥）。
  - [ ] 缺失时直接抛错，避免“带病上线”。
- [ ] 精简 OAuth 权限（Scopes）
  - [ ] 检查 `SCOPES` 设置，只保留功能必需的权限。当前需要：`read_orders`（订单和金额）、`read_refunds`（退款）、`read_customers`（客户去重与汇总）、`read_products` / `read_inventory`（成本、库存与报表维度）。
  - [ ] 每一项 scope 都能在文档中解释“为什么需要”。

## 二、会话存储与缓存（防止生产内存模式）

- [ ] 确保生产环境使用数据库会话存储
  - [ ] 配置生产环境的 `DATABASE_URL` 指向可靠数据库（Postgres/MySQL 等）。
  - [ ] 确认 Shopify session 存储实际走 `PrismaSessionStorage`，不是内存 `Map()`。
- [ ] 避免生产使用进程内缓存
  - [ ] 如需分布式缓存，提前接入外部服务；当前默认仅使用进程内缓存，适合单实例部署。
  - [ ] 多实例部署时，确保所有实例共享缓存 & 会话（或接受短暂不一致）。

## 三、安全性加固

- [ ] 自定义公式求值：逐步摆脱 `Function(...)`
  - [ ] 短期：字符白名单严格、变量全部替换为数字、不允许访问原型链或全局对象。
  - [ ] 中长期：评估替换为安全表达式解析器（不再使用 `Function` / `eval` 类机制），写下技术路线说明。
- [ ] 原始 SQL 使用审查
  - [ ] 搜索所有 `$executeRaw` / `$queryRaw` 使用点，确认参数均为内部计算结果。
  - [ ] 优先改用 Prisma ORM API；若必须用原始 SQL，在注释中说明原因与安全边界。
- [ ] 日志敏感信息过滤
  - [ ] 检查 `console.log` / `logger.log`，不打印 token、session、密码、密钥、完整 webhook payload 等敏感字段。
  - [ ] 对必要的调试信息做脱敏（例如只打印部分 ID）。
- [ ] CSP / 安全响应头确认
  - [ ] 设置 Content-Security-Policy、X-Frame-Options（按 Shopify 嵌入式要求设置）、X-Content-Type-Options、Referrer-Policy。
  - [ ] 确保不会和 Shopify Admin 的嵌入式要求冲突（按官方模板来）。
- [ ] CSRF 风险评估
  - [ ] 确认认证方式主要依赖 Shopify 的 JWT / Session Token，而非自建 Cookie Session。
  - [ ] 若存在任何基于 Cookie 的登录 / 设置接口：为相关表单加入 CSRF Token 校验，或至少设置 Cookie 的 `SameSite` 属性为 `Lax/Strict`。

## 四、日志等级、监控与错误处理

- [ ] 生产日志等级调整
  - [ ] 在 `shopify.server.js` / 日志配置中：开发环境 `LogSeverity.Debug`，生产环境 `LogSeverity.Info` 或 `Warning`。
  - [ ] 确保不会在生产打印过多 debug 细节和敏感信息。
- [ ] 统一错误展示 & 捕获
  - [ ] 后端：对关键路由加上 try/catch，统一返回结构化错误。
  - [ ] 前端：提供统一的错误提示组件，显示友好文案，而非 raw stack。
  - [ ] 对 Shopify API 调用失败（rate limit、权限不足）有清晰提示与重试逻辑。
- [ ] 基础监控预留
  - [ ] 在关键操作处留好埋点位置（便于接入 Sentry / Log service）。
  - [ ] 至少能在日志中迅速定位：安装失败、计费失败 / 取消订阅、关键数据生成/同步异常。

## 五、产品体验与审核关注点

- [ ] 安装流程全链路自测
  - [ ] 使用 Partner 的测试店铺，从 App Store 安装入口：安装 → 授权 → 首次进入 → 初始引导 → 升级/订阅 → 正常使用。
  - [ ] 确保任何一步失败都有清晰错误提示，不出现“白屏 / 空页面 / 无限加载”。
- [ ] 权限说明与 onboarding
  - [ ] 在应用内部说明每个 Shopify 权限的用途。
  - [ ] 首次进入时用简短向导告知“应用会读取哪些数据，用来做什么”。
- [ ] 卸载体验
  - [ ] 测试从店铺卸载 app：卸载后不再向店铺前端注入任何 JS/CSS；`app_uninstalled` webhook 清理店铺数据 / 会话；刷新后台不会跳转到无效页面。
- [ ] UI 细节与文案
  - [ ] 去除所有 `TODO` / `Coming soon` / 临时测试文案。
  - [ ] 确保主流程相关的页面都有清晰标题和说明。
  - [ ] 针对报错、空数据状态提供友好的说明。

## 六、文档、合规与 Partner 配置

- [ ] 隐私政策 & 使用条款
  - [ ] 准备并上线隐私政策（Privacy Policy）、使用条款（Terms of Service）。
  - [ ] 在 Partner Dashboard 的 app 设置和 app 内部都提供可点击链接。
- [ ] 数据使用说明
  - [ ] 在文档或应用页面明确说明：读取哪些 Shopify 数据（订单、产品、广告数据等）、存储在哪里（数据库、缓存、加密方式）、用于哪些功能（报表、分析、推荐等）。
- [ ] Partner Dashboard 配置
  - [ ] 确保应用名称、图标、截图、长短描述已准备好；主页 / 支持网站 / 联系邮箱有效；安装 URL 指向部署好的 `SHOPIFY_APP_URL`；Billing 方案与代码里的收费逻辑一致（价格、试用期等）。

## 七、自动化 & 回归测试（加分项）

- [ ] 关键路径自动化测试
  - [ ] 为安装 & 会话初始化、计费创建 / 激活 / 取消、自定义公式计算（含异常 case）、核心报表生成编写基础测试。
- [ ] 部署前检查脚本
  - [ ] 可选：添加脚本（或 Git Hook）在部署前运行 ESLint / TypeScript、`npm audit --production`、自定义“生产环境变量存在性”检查。

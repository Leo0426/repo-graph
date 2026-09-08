# 支付平台安全架构演示

这是一组为 RepoGraph UI 设计的可解释数据：同一业务能力同时保留风险路径、安全对照、鉴权证据与
供应链风险。演示目标不是只给出告警，而是回答“入口在哪里、数据流向哪里、谁会受影响、如何修复”。

## 支付订单检索为什么存在 SQL 注入风险

客户名称来自公开 HTTP 参数，`trim()` 只清理空白字符，不是安全净化。完整证据链是：

`OrderController#search(String)` → `OrderService#searchOrders(String)` →
`UnsafeGateway#findByCustomer(String)` → `Statement.executeQuery(String)`

危险网关把 `customer` 直接拼进 SQL。攻击者可改变 WHERE 条件，读取不属于自己的支付订单。

## 参数化查询如何阻断 SQL 注入

安全对照路径 `OrderController#safeSearch(String)` 最终进入
`UnsafeGateway#findByCustomerSafely(String)`。SQL 结构固定为 `customer = ?`，用户输入只作为值绑定，
无法变成操作符或子查询。业务行为相同，但信任边界和 Sink 使用方式不同。

## 未经授权的退款接口如何访问数据库

`RefundController#refundWithoutAuthorization(String)` 没有角色注解，却能沿调用链进入
`Statement.executeUpdate(String)`。对照端点 `refundWithFinanceRole(String)` 使用
`@PreAuthorize("hasRole('FINANCE_ADMIN')")`，并落到参数化更新，展示鉴权与输入安全是两条独立防线。

## 从 HTTP 入口追踪用户输入到危险 Sink

先定位 Controller 的公开路由，再展开 Callees 到 Service 和 Gateway；反向查看 Callers 可确认危险
网关的所有入口。影响面分析用于回答：修复 `findByCustomer` 或 `refundUnsafe` 会波及哪些 API 与业务服务。

## 供应链中的 Log4Shell 风险

演示项目故意保留 `log4j-core 2.14.1`，用于命中 Log4Shell（CVE-2021-44228）；同时包含旧版
Jackson 和 Spring Security，形成包含直接依赖、CVE、严重度与升级建议的 SBOM 风险画像。

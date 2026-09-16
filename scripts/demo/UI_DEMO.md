# RepoGraph UI 演示手册

## 演示目标

用一套小而完整的支付系统数据，在 UI 中连续讲清楚四件事：自然语言能找到代码、代码关系能形成图、
安全问题有跨方法证据、修复方案有可搜索的安全对照。建议演示 8～12 分钟。

## 0. 首次准备（约 1 分钟）

进入「索引」，项目根目录填写：

```text
/Users/leolu/Projects/personal_projects/repo-graph/scripts/demo/showcase-project
```

选择 Java、C、Python 和 Markdown，打开「强制重建索引」，点击「开始索引」。状态完成后，在页面顶部
选择刚生成的 `showcase-project`。演示期间只索引这个目录，结果会比索引 RepoGraph 自身更集中。

## 1. 语义搜索：先展示答案，再展开证据（约 3 分钟）

在「搜索 → 语义」逐条粘贴以下问题。第一次搜索保持语言和类型为「全部」，让 DOCUMENT、METHOD、
CLASS 混排；点击结果卡片的源码区域，展示中文解释和真实实现位于同一份索引中。

| 搜索内容 | 预期的漂亮结果 | 讲解重点 |
|---|---|---|
| `支付订单检索为什么存在 SQL 注入风险` | 风险架构文档、`OrderController#search`、`UnsafeGateway#findByCustomer` | 自然语言问题能落到入口与 Sink |
| `参数化查询如何阻断 SQL 注入` | 安全架构文档、`safeSearch`、`findByCustomerSafely` | 风险实现与修复实现成对出现 |
| `未经授权的退款接口如何访问数据库` | 退款鉴权文档、`refundWithoutAuthorization`、`refundUnsafe` | 缺少鉴权与危险写操作是两类证据 |
| `供应链中的 Log4Shell 风险` | 供应链风险文档，包含 CVE-2021-44228 和 Log4j 版本 | 代码知识与依赖知识能统一检索 |
| `从 HTTP 入口追踪用户输入到危险 Sink` | 安全架构文档、Controller、Service、Gateway | 从解释跳转到完整调用链 |

随后切换到「代码」搜索，粘贴：

```java
String sql = "select id from orders where customer = '" + customer + "'";
statement.executeQuery(sql);
```

预期命中 `com.acme.showcase.gateway.UnsafeGateway#findByCustomer(String)`。此处强调代码检索不要求完全相同，
适合查找仓库里的相似危险实现。若结果太多，过滤 Java + METHOD。

## 2. 图谱：把搜索结果变成可交互证据链（约 2 分钟）

进入「图谱」，深度设为 4，按下面顺序演示：

1. 目标填 `com.acme.showcase.api.OrderController#search(String)`，选择「被调用」，查看入口到 Service、
   Gateway 和数据库调用的下游路径。
2. 目标填 `com.acme.showcase.gateway.UnsafeGateway#findByCustomer(String)`，选择「调用方」，反向确认危险
   Sink 被哪些业务入口触达；再切换「影响面」展示修复波及范围。
3. 目标填 `com.acme.showcase.api.RefundController#refundWithoutAuthorization(String)`，选择「被调用」，
   对比未鉴权入口到数据库写操作的链路。
4. 目标填 `com.acme.showcase.format.ReportFormatter`，选择「子类型」，展示接口与实现类关系。

图上可点击 Service 或 Gateway 节点，再点「以此节点为目标查询」，形成自然的探索过程。

## 3. 漏洞：从告警跳到路径和影响面（约 2 分钟）

进入「漏洞」，依次运行：

1. 「代码扫描」：展示 SQL 拼接、命令执行、反序列化、弱哈希、硬编码密码等多类规则。
2. 「污点扫描」：重点展开订单检索路径和退款路径，查看 HTTP 参数如何跨方法到达 SQL Sink。
3. 「依赖扫描」：展示 `log4j-core 2.14.1` 对应 CVE-2021-44228，以及旧版 Jackson、Spring 依赖。

选中 `UnsafeGateway#findByCustomer` 相关 finding 后点击「影响面」，即可从安全结果回到图谱证据。

## 4. 入口、SBOM 与质量画像（约 2 分钟）

- 在「工具」查看框架入口点，重点对比 `/demo/refunds/unsafe` 与带
  `@PreAuthorize("hasRole('FINANCE_ADMIN')")` 的 `/demo/refunds/approved`。
- 在「SBOM」生成依赖清单和依赖图，观察 Log4j、Jackson、Spring Web、Spring Security 四条直接依赖。
- 在「统计 / 质量」查看复杂度、耦合和热点；`SecurityShowcase#demonstrateAll` 被刻意设计为高信号方法，
  便于展示质量指标与安全扫描关注点并不完全相同。

## 5. 收尾话术（约 30 秒）

> RepoGraph 不只告诉我们“这里可能有漏洞”。它把自然语言需求、代码实现、调用关系、污点证据、鉴权
> 证据和供应链风险组织为一套可继续探索的工程上下文；同一 UI 中既能说明为什么危险，也能找到可复用
> 的安全实现。

## 演示稳定性提示

- 必须等待索引状态完成后再搜索；向量尚未完成时，语义结果可能暂时为空。
- 图谱目标优先从搜索卡片复制 qualified name，避免手输签名差异。
- Markdown 文档特意包含自然语言问题；Java Javadoc 特意包含业务语义，因此中英文查询都可演示。
- 这是故意含漏洞的离线测试项目，不应运行或部署其中的业务代码。

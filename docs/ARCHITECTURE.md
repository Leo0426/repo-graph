# RepoGraph Architecture

本文件负责改动放置和依赖边界；完整领域模型、状态定义与决策仍以 [CONTEXT.md](../CONTEXT.md) 为准。

## 交付与依赖

`settings.gradle.kts` 定义两个子项目。`repograph-app` 是 Spring Boot Web/REST 应用，
`repograph-mcp` 是独立 JSON-RPC stdio 服务，通过 `RepographApiClient` 转发 HTTP 请求。
MCP 新工具复用 app 的领域能力，不在传输层复制索引、研判或持久化逻辑。

app 内包位于 `repograph-app/src/main/java/com/repograph/`：

| 改动 | 放置及边界 |
|------|------------|
| 领域模型、服务接口 | `core`；只依赖 JDK 和 core，不引入第三方或实现包依赖 |
| 语言解析 | `parser`；产出 CodeUnit/RelationEdge，框架标注由 `framework` 增强 |
| 图查询/存储 | `graph`；不依赖 `vector` |
| 向量/Embedding 适配 | `vector`；通过 core 接口被上层消费 |
| 索引编排 | `app/pipeline`；协调解析、图、Embedding、向量与增量缓存 |
| 检索及上下文预算 | `retrieval`；组合图、向量、关键词，输出 Context Pack |
| 外部报警与人工审核 | `finding`；持有导入、研判、反馈、抑制、快照和审核事实 |
| 内置扫描与漏洞状态 | `vuln`；持有 VulnFinding 与漏洞证据 |
| 模型建议 | `advisory`；提供独立辅助结果，不改启发式报告或漏洞状态 |
| 工作流与步骤台账 | `agent`；通过稳定引用组合已有领域结果 |
| 不可信源码及工具进程 | `asset` 接入归档，`scanner` 适配外部扫描器 |
| HTTP 和页面 | `api` 控制器及 `src/main/resources/templates`、`static` |

旧规则中的 `repograph-core/graph/vector` 指以上逻辑包边界，不能据此创建反向依赖。
实现依赖 core 契约；接口位于 core，具体实现位于对应能力包。

## 主链路与事实归属

- 索引顺序：扫描 → 增量过滤 → 解析 → 元数据增强 → 图写入 → Embedding → Qdrant → SQLite 缓存。
  顺序不可打乱；跨存储删除和更新经索引存储协调层处理。
- Neo4j 持有符号与关系，Qdrant 持有双向量，SQLite 持有增量缓存、研判/审核与运行记录。
  修改共享模型前同时检查三类映射；不得把某个存储副本当成新领域事实源。
- 研判：外部 finding → 代码定位/Context Pack → 证据增强 → 启发式报告 → 人工审核。
  core 的 `TriageWorkflow` 契约由 finding 的 `DefaultTriageWorkflow` 实现，普通报告、审核快照与
  Agent 共享策略；入口保留协议、快照提交和时间线等各自职责。
  `ExternalFinding` 保持输入事实；历史反馈、防护与抑制进入独立 decisionEvidence。
- AgentRun/AgentStep 记录执行状态与结果引用，不复制 ScanTask、TriageReport、ContextPack 或审核事实。
  报告导出从冻结快照派生；模型建议独立保存，不替换人工审核使用的启发式报告。
- EXTENDS 与 IMPLEMENTS 分开存储；未解析调用不建立 CALLS 边；DOCUMENT 不产生调用语义。
- `GraphExportService` 只做包级依赖聚合，不暴露方法级依赖图。

共享模型/metadata 的入口约束见 [AGENTS.md](../AGENTS.md)，失败处理见
[Reliability](rules/RELIABILITY.md)，输入信任边界见 [Security](rules/SECURITY.md)。

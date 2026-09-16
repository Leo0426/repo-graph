# RepoGraph — Agent Rules

先读 [CONTEXT.md](CONTEXT.md) 了解项目背景，再按任务读取下列职责文档。这里负责入口、路由和执行顺序。

## 项目事实和现状

- 实际 Gradle 子项目只有 `repograph-app` 和 `repograph-mcp`。`core`、`graph`、`vector` 等是 app 内的包边界。
- `CONTEXT.md` 保留完整领域上下文、metadata key 和架构决策；没有独立 ADR 目录。
- app 提供 Web/REST；MCP 是独立 stdio 进程，通过 HTTP 调用 app。MCP stdout 只允许 JSON-RPC。

## 工作策略

| 任务 | 开始前读取 |
|------|------------|
| 新接口、持久状态、跨包依赖、调用链 | [Architecture](docs/ARCHITECTURE.md) |
| 仓库特有术语、同名概念或词义不确定 | [Glossary](docs/GLOSSARY.md) |
| Java 实现、测试用例、版本声明 | [Coding](docs/rules/CODING.md) |
| 安装、启动、配置、排障 | [Development](docs/DEVELOPMENT.md) |
| 解析降级、索引失败、重试、状态迁移、协议兼容 | [Reliability](docs/rules/RELIABILITY.md) |
| 归档上传、模型输入/输出、外部扫描器、敏感信息 | [Security](docs/rules/SECURITY.md) |
| 共享样式、字号、视觉状态 | [Design System](docs/DESIGN_SYSTEM.md) |
| Agent 工作台、轮询、流式输出、人工审核交互 | [Interaction Design](docs/INTERACTION_DESIGN.md) |

- 修改 `CodeUnit` 字段前核对 Qdrant payload、SQLite 缓存和 Neo4j 映射兼容性；不得随意增删。
- 新增 metadata key 时同步 `CONTEXT.md` 的标准 key 表。
- Issues/PRD 以 `.scratch/` 为权威版本；处理工单前读 [issue tracker](docs/agents/issue-tracker.md)
  和 [triage labels](docs/agents/triage-labels.md)。只领取 `ready-for-agent`，不领取 `ready-for-human`。
- [Reliability](docs/rules/RELIABILITY.md) 中的已知分析局限只记录，不作为本轮顺手修复范围。

## 验证入口

按 [Validation](docs/VALIDATION.md) 选择真实 Gradle 检查和对应的领域测试。
报告实际执行结果，区分失败、未运行、跳过与通过；快速构建不能证明测试通过。

## 漂移处理

先核对 `settings.gradle.kts`、构建任务、运行配置及直接实现/测试；领域含义回到 `CONTEXT.md`。
入口或路由漂移修复本文件，工程操作与规则修复对应职责文档，领域模型/metadata/决策修复 `CONTEXT.md`。
冲突时保留证据并明确说明，不用实现中的偶然行为改写已确认的硬性约束。
领域读取约定见 [domain](docs/agents/domain.md)。

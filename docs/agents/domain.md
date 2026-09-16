# 领域文档

工程类 skills 在探索代码库时，应如何读取此仓库的领域文档。

## 探索前，先读取这些

- 仓库根目录的 **`CONTEXT.md`** — 包含项目定位、模块结构、核心领域模型、索引管道说明，以及末尾的架构决策表。
- 本仓库**无独立 `docs/adr/` 目录**，所有架构决策内联在 `CONTEXT.md` 末尾的"架构决策记录"表格中。

如果这些文件不存在，**静默继续**。不要标记它们的缺失；不要主动建议创建。

## 文件结构

领域上下文保持单一；工程职责按任务从 AGENTS.md 路由：

```
/
 CONTEXT.md          ← 完整上下文 + 架构决策表
 AGENTS.md           ← Agent 入口、职责路由、执行 gate
 docs/ARCHITECTURE.md ← 改动放置与依赖地图，指回 CONTEXT.md
 docs/GLOSSARY.md    ← CONTEXT.md 已有术语的简短索引
 docs/VALIDATION.md  ← 验证命令、前提与结果解释
 docs/DEVELOPMENT.md ← 本地环境与排障
 docs/rules/         ← 编码、可靠性、安全规则
 repograph-app/      ← Spring Boot 应用（API + Web UI + 核心逻辑）
 repograph-mcp/      ← MCP 服务器模块
```

## 使用词汇表中的术语

当输出命名一个领域概念时（issue 标题、重构提案、假设、测试名称），先查 `docs/GLOSSARY.md`；
详细语义仍使用 `CONTEXT.md` 的定义。不要漂移到词汇表明确避免的同义词。

关键术语：`CodeUnit`、`CodeUnitKind`、`RelationEdge`、`EdgeKind`、`projectId`、`qualifiedName`、`metadata`、解析策略（`PRECISE / HEURISTIC / AUTO`）。

## 标记架构决策冲突

如果你的输出与 `CONTEXT.md` 末尾"架构决策记录"表格中的决策相矛盾，明确标注，而不是静默覆盖：
> _与 CONTEXT.md 中现行架构决策冲突：说明具体决策、当前证据和需要重新讨论的原因。_

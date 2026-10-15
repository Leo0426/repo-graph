# S3:增量更新 + 版本树 + MCP 工具

Status: ready-for-agent

## 背景

DeepMap 借鉴设计 §3.5 增量与 §3.6 MCP 部分。
前置：S2 完成（摘要入库为 DOCUMENT CodeUnit 后增量才有意义）。

## 范围

- 增量触发：复用文件监听与索引增量结果，变更文件所属包标记摘要 dirty；
  仅重生成 dirty 包子摘要，架构摘要追加"增量变更说明"章节
- 更新期间旧摘要保持可检索（先写新版本再切换）
- 版本树：旧版本目录保留回看（.repograph/wiki/**/vN 约定）
- MCP：新增 `get_project_summary` 与 `search_wiki`（复用 app 领域能力，不在传输层复制逻辑）

## 验收标准

- [ ] 修改文件后增量冒烟：仅 dirty 包重生成，其余包 docVersion 不变
- [ ] `./gradlew :repograph-mcp:test` 新工具契约测试通过 + 完整进程 JSON-RPC stdout 核对
- [ ] 不做远端 commit 轮询（本地增量以文件监听为准，边界写入 docs）

## 评论

- 2026-10-15 从 DeepMap 借鉴设计拆出。

# S3:文档入库 + Web 文档树页 + 增量更新 + MCP 工具

Status: ready-for-agent

## 背景

DeepMap 借鉴设计 §3.4 Phase 4/Phase 5、§3.5 增量、§3.6 MCP/Web 部分。
前置：S2 完成（LLM 架构摘要 + 阶段缓存已落地）。
自 S2 评审起，本 issue 同时承接原 S2 的入库与 Web 页面范围。

## 范围

- 文档入库（Phase 4）：摘要 Markdown 落盘 + MarkdownDocParser → DOCUMENT CodeUnit
  入图与向量。**前置设计题**：本地项目无法把生成文件写进用户仓库（projectRoot），
  需确定落盘位置与 projectId 归属方案（候选：受控 wiki 目录 + 独立文档项目，或
  indexStore 直接写入绕过文件扫描），设计确认后实现
- metadata key：`is_generated="true"` 与 `doc_version`；**须同步 CONTEXT.md 标准 key 表**
  并核对 Qdrant payload / SQLite 缓存 / Neo4j 三处映射兼容性
- Web 文档树页：工作台内"项目文档"页（文档树 + 章节浏览 + citation 跳转 +
  生成进度轮询），遵循 DESIGN_SYSTEM 与 INTERACTION_DESIGN
- 增量更新：复用文件监听与索引增量结果，变更文件所属包标记摘要 dirty；
  仅重生成 dirty 包子摘要，架构摘要追加"增量变更说明"章节；更新期间旧摘要可检索
- MCP：新增 `get_project_summary` 与 `search_wiki`（复用 app 领域能力）

## 验收标准

- [ ] metadata key 三处映射兼容性核对 + CONTEXT.md key 表同步
- [ ] 语义检索能命中生成的摘要内容（真实项目索引后冒烟）
- [ ] 修改文件后增量冒烟：仅 dirty 包重生成，其余包 docVersion 不变
- [ ] UI 页面手工冒烟 + `node --test` UI 回归
- [ ] `./gradlew :repograph-mcp:test` 新工具契约测试通过 + 完整进程 JSON-RPC stdout 核对
- [ ] 不做远端 commit 轮询（本地增量以文件监听为准，边界写入 docs）

## 评论

- 2026-10-15 从原 S2 承接入库与 Web 页面范围（原 S2 范围调整，见 issue 02）。

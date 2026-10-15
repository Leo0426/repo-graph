# S2:LLM 架构摘要 + 阶段缓存/续跑 + Web 文档树页

Status: ready-for-agent

## 背景

DeepMap 借鉴设计 §3.4 Phase 2/Phase 4/Phase 5 与 §3.6 Web 部分。
前置：S1 已完成（.scratch/deepmap-wiki-summaries/issues/01-structure-card-and-package-summaries.md）。

## 范围

- LLM 架构摘要：输入 = S1 结构卡 + 关键符号签名（预算裁剪 + advisory 脱敏），
  章节：项目概述 / 模块划分 / 入口与调用链 / 构建与运行 / 安全相关面；单章节失败跳过
- LLM 通道：复用 Agent 页面保存的 Ollama 开关/BaseURL/模型/超时；默认关闭；
  独立 executor，不占用 llmAdvisoryExecutor / architectureReviewExecutor
- 阶段缓存：按 (projectId, codeVersion, phase, scopeId) 落 SQLite，重启续跑跳过已完成项
- 入库：Markdown → MarkdownDocParser → DOCUMENT CodeUnit 入图与向量；
  metadata 新增 `is_generated="true"` 与 `doc_version`（**须同步 CONTEXT.md 标准 key 表**，
  并核对 Qdrant payload / SQLite 缓存 / Neo4j 三处映射兼容性）
- generate 切换 202 + 后台执行，复用 agent executor 队列与拒绝语义；任务台账走 AgentRun/AgentStep
- Web：工作台内"项目文档"页（文档树 + 章节浏览 + citation 跳转），轮询生成进度

## 验收标准

- [ ] Ollama 开/关两态降级验证：关闭时只产出 S1 结构卡，页面显式标注
- [ ] 模型 citation 只能引用输入事实已有条目，非法引用进 missingInfo
- [ ] metadata key 三处映射兼容性核对 + CONTEXT.md key 表同步
- [ ] `./gradlew test` 全量通过 + UI 手工冒烟

## 评论

- 2026-10-15 从 DeepMap 借鉴设计拆出。

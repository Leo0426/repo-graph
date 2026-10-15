# S2:LLM 架构摘要 + 阶段缓存/续跑 + 异步执行

Status: resolved

## 背景

DeepMap 借鉴设计（docs/generated/deepmap-design-borrow-2026-10-12.md §3.4 Phase 2/Phase 5、
§3.6 REST 部分、§3.7 安全边界）。前置：S1 已完成。

## 实现

- LLM 通道：`core.wiki.WikiSummaryModel` 契约 + `OllamaWikiSummaryModel` 适配
  （复用 advisory 页面开关/BaseURL/模型与 llmAdvisoryRestTemplate 超时边界）
- 提示词：事实 + 复杂度符号签名（脱敏 WikiPromptSanitizer + maxInputChars 预算裁剪）；
  单章节独立生成（5 章节），失败跳过互不阻断
- citation 白名单：只允许结构事实已有的 qualifiedName；白名单外引用丢弃并写 missingInfo
- 阶段缓存：`summary_generation_cache`（projectId+scope+phase+factsHash），
  同一事实指纹下重试不重复消耗模型调用
- 异步：generate 切换 202 + `wikiSummaryExecutor`（独立单线程有界队列），
  台账复用 AgentRun/AgentStep（playbook = WIKI_SUMMARY，步骤 FACTS/LLM_ARCH/PERSIST），
  队列满 503 EXECUTOR_REJECTED
- SummarySection 增加 source（facts/llm）、SummaryDocument 增加 model/missingInfo
  （旧 JSON 行兼容，紧凑构造器缺省）

## 范围调整（2026-10-15 评审）

- **入库（Phase 4）与 metadata key（is_generated/doc_version）移入 S3**：
  本地项目无法把摘要落盘到 projectRoot 内，indexFile 入库路径需要另行设计
- **Web 文档树页移入 S3**（REST 已就绪，页面属独立前端工作量）

## 验收标准

- [x] Ollama 开/关两态降级：关闭只产出确定性结构卡；开启时章节标记 llm、失败标 PARTIAL
- [x] 模型 citation 白名单校验：非法引用丢弃并进 missingInfo
- [x] 阶段缓存：同指纹重试不重复调用模型（测试验证 calls==5 两次生成）
- [x] `./gradlew test` 全量通过（1067 tests, 0 失败）
- [ ] UI 手工冒烟 → 移入 S3（页面未实现）

## 评论

- 2026-10-15 实现完成。范围调整如上，S3 承接入库 + UI 页面 + 增量 + MCP。

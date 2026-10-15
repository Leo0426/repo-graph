# S1:结构卡 + 确定性包摘要 + SummaryStore + REST 最小闭环

Status: resolved

## 背景

DeepMap 借鉴设计（docs/generated/deepmap-design-borrow-2026-10-12.md §3.8）切片 S1：
无 LLM 的分层摘要最小闭环。

## 实现

- core 契约：`com.repograph.core.wiki`（SummaryDocument / SummarySection / SummaryCitation /
  SummaryLevel / SummaryTreeNode / SummaryGenerationService）
- 实现：`com.repograph.wiki`（StructureFactCollector 事实收集 + DefaultSummaryGenerationService
  确定性生成 + SummaryStore SQLite）
- REST：POST /api/v1/summaries/generate、GET /api/v1/summaries、/tree、/{id}
- 与设计的偏差：generate 为同步执行（无 LLM，耗时可控）；S2 引入 LLM 后切换 202 + 后台执行。

## 验收标准

- [x] `./gradlew test` 全量通过（1050 tests, 0 失败）
- [x] 项目级结构卡 + 包级子摘要生成、docVersion 递增、旧版本保留
- [x] 空项目返回空列表；citation 只指向图内真实符号（复杂度热点）

## 评论

- 2026-10-15 实现完成。全量 1050 tests / 0 失败 / 2 skipped（原有正常跳过）。

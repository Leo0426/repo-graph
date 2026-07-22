Status: resolved

# Triage Report Generator

## 目标

为单条外部报警生成 Markdown / JSON 研判报告。

## 范围

- 报警摘要
- 初步结论：TRUE_RISK / LIKELY_FALSE_POSITIVE / NEEDS_REVIEW
- 证据链
- 缺失信息
- 修复建议
- 给研发的解释文本

## 验收标准

- [x] 报告包含至少一个 citation
- [x] 结论必须带置信度或缺失信息说明
- [x] Markdown 可直接复制到 issue / PR 评论
- [x] JSON 输出字段稳定

## 完成记录

- 新增 `TriageVerdict`、`TriageReport`（core.finding）
- 新增 `TriageReportService`：启发式基线（定位 + 安全信号 + 调用方可达性 → 结论/置信度），不依赖 LLM，结论只引用证据链
- CWE 修复建议映射（78/89/79/22/502）+ 通用兜底
- `toMarkdown` 渲染含证据 citation、缺失信息、修复建议章节
- `TriageReportServiceTest` 覆盖三种结论、Markdown 章节、JSON 字段稳定性

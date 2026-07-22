Status: resolved

# Triage Feedback Store

## 目标

持久化用户对研判结果的反馈，用于闭环和后续企业知识沉淀。

## 范围

- 状态：TRUE_POSITIVE / FALSE_POSITIVE / NEEDS_REVIEW / FIXED
- 记录 reviewer、reason、updatedAt
- SQLite 存储
- 与外部 finding id 或 fingerprint 关联

## 验收标准

- [x] upsert 幂等
- [x] 可按 projectId / status 查询
- [x] 非法状态返回明确错误
- [x] 测试使用临时 SQLite 或内存库

## 完成记录

- `ExternalFinding` 新增 `fingerprint()`：`SHA256(tool|ruleId|filePath|startLine)[:16]`
- 新增 `TriageFeedbackStatus`（含 `parse` 明确报错）、`TriageFeedback`（core.finding）
- 新增 `TriageFeedbackStore`：SQLite `triage_feedback` 表，指纹主键 upsert 幂等，按 projectId/status 查询
- `TriageFeedbackStoreTest`（@TempDir SQLite）+ `ExternalFindingTest` 指纹稳定性测试

Status: resolved

# Triage REST 入口

## 目标

打通 P0 端到端流程：上传 SAST 报警 JSON → 导入 → 上下文构建 → 研判报告；反馈闭环读写。

## 范围

- `POST /api/v1/triage/report`：body 为 Semgrep/SARIF JSON，format 参数选择导入器，逐条生成报告（JSON + Markdown）
- `POST /api/v1/triage/feedback`：按指纹 upsert 反馈
- `GET /api/v1/triage/feedback`：按 projectId / status 查询
- 导入失败 → 400，不支持的 format → 400，非法状态 → 400
- MCP 工具入口 `triage_finding`、`record_triage_feedback`、`list_triage_feedback`

## 验收标准

- [x] 单请求可对一批报警生成报告，含 markdown 字段
- [x] 无效 JSON / 不支持格式返回 400 与明确错误
- [x] 反馈 upsert / 查询可用，非法状态 400
- [x] Web 层测试覆盖以上路径
- [x] MCP 工具可调用 `/api/v1/triage/report` 并格式化报告
- [x] MCP 工具可写入和查询 `/api/v1/triage/feedback`

## 完成记录

- 新增 `TriageController`（/api/v1/triage/report、/feedback GET/POST），单请求上限 50 条报警
- `GlobalExceptionHandler` 新增 `ExternalFindingImportException` → 400 映射
- `TriageControllerTest` 覆盖报告生成、不支持格式、无效 JSON、反馈写入/非法状态/过滤查询
- 新增 MCP 工具 `triage_finding`，支持 Semgrep / SARIF / CodeQL JSON 研判报告
- 新增 MCP 工具 `record_triage_feedback` / `list_triage_feedback`，支持人工复核结果回写与查询
- SARIF 改为从 HTTP 请求流按 `runs/results` token 流式解析；导入阶段按 `maxFindings` 限制保留数量

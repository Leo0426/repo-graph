# T9 遗留 2:多快照批量导出

Status: resolved

## 背景

T9 能力矩阵遗留:"缺少批量导出多个快照"。当前
`GET /api/v1/review-queue/snapshots/{snapshotId}/export` 仅支持单快照导出(markdown/json/pdf)。
真实试用场景(周报、跨项目汇总、离线审计)需要一次导出多份快照。

## 要构建什么

- 新端点 `POST /api/v1/review-queue/snapshots/export-batch`,请求体
  `{"snapshotIds": ["a","b"], "format": "markdown" | "json" | "pdf"}`,响应 `application/zip`。
- ZIP 结构(决策默认,可推翻):
  - `snapshots/<snapshotId>/report.md | report.json | report.pdf` —— 完全复用现有
    `ReviewQueueController` 单快照导出的同源渲染路径(禁止另写一份渲染逻辑);
  - `manifest.json` —— 请求的每个 snapshotId 一条记录:
    `{"snapshotId": "...", "status": "exported" | "missing", "file": "snapshots/.../report.md"}`。
- **缺失语义**:部分 snapshotId 不存在 → 正常 200,`manifest` 标记 `missing`(不伪装成全部成功);
  **全部缺失 → 404**。
- 大小与数量限额:`snapshotIds` 上限 100(超限 400 结构化错误);单快照渲染超时/失败按
  `missing` + 原因记入 manifest,不中断整包(与扫描器失败隔离语义一致)。

## 验收标准

- [x] 2+ 个存在的快照 + markdown/json/pdf 三种格式 → ZIP 内文件齐全,内容与单快照导出逐字节一致
- [x] manifest.json 准确反映 exported/missing 状态
- [x] 部分缺失 → 200 + manifest 标记;全部缺失 → 404;超 100 个 id → 400(空列表 → 400)
- [x] 单快照渲染失败不中断整包,原因进入 manifest
- [x] `ReviewQueueControllerTest` 契约覆盖以上分支(5 个新用例)

## 验证方式

`ReviewQueueControllerTest`(MockMvc,构造 ≥2 快照的真实 store 场景)+ ZIP 内容断言
(java.util.zip 读取条目比对)。命令:`./gradlew :repograph-app:test`。

## 范围外

- 不做异步导出任务(DeepMap 式 start/status/download;当前数量级同步即可,大仓库导出变慢再升级)
- 不做 DOCX
- 不改单快照导出端点行为

## 评论

- 2026-10-13:完成。`POST /api/v1/review-queue/snapshots/export-batch` 落地,复用单快照导出的
  `renderMarkdown`/`writeJson`/`ReportPdfRenderer.render` 同源路径;manifest 经 Jackson 序列化
  (新增 `writeJson(List<BatchManifestEntry>)` 重载)。请求 id 去重保序(防 ZIP 重名条目),
  空/超 100/未知格式 → 400,全缺 → 404,渲染异常按 missing 记录不中断。5 个新契约用例全过;
  全量回归 949 tests,6 failures 与改动前一致(既有 Windows 环境失败)。
  GitHub 同步跳过(gh 未登录)。

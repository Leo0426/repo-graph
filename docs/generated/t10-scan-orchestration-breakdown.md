# T10 批量扫描任务编排和 Slither 接入 — 任务拆分

> 来源：`docs/generated/next-development-plan-audit-platform.md` 的 T10。
> 拆分方式：垂直切片（tracer bullet），每片端到端可验证，不做前后端水平拆分。
> 基线：T3 已交付同步 `ExternalScanService.scan(asset, options) → ExternalScanBatchResult`，
> 含 per-scanner `ScannerRunStore`（`scanner_runs`）、`(project_id, fingerprint)` 幂等 `external_findings`、
> `ScanBatchStatus{SUCCEEDED/PARTIAL/FAILED}`、`ScannerController`。T10 在其上叠加**异步任务层**。

## 领域新词

| 术语 | 含义 |
|------|------|
| `ScanTask` | 一次异步扫描任务，包裹一批扫描器执行 |
| `ScanTaskStatus` | `QUEUED / RUNNING / SUCCEEDED / PARTIAL / FAILED / CANCELLED` |
| `ScanTaskStore` | 任务状态与 attempt 的 SQLite 持久化 |
| `ScanTaskScheduler` | 有界 worker 池 + 全局/项目/扫描器级并发配额调度 |

领域模型置于 `com.repograph.core.scanner`，进程/SQLite/调度实现在 `com.repograph.scanner`，
与 T3 分层一致。

## 决策默认（已定，可推翻）

- **重试为手动 API，不做自动重试**：更显式、状态机更简单；若需「瞬时失败自动重试 N 次」再单开一片。

---

## 任务拆分

### T10-1　异步扫描任务骨架：提交 → 轮询状态 → 分页取结果（MVP 脊柱）✅ 已完成（2026-08-01）

- **类型**：AFK
- **被阻塞于**：无
- **覆盖验收**：任务状态机（除 CANCELLED）、PARTIAL 容错、分页结果、结构化失败原因
- **要构建什么**：`POST /api/v1/assets/{assetId}/scan-tasks` 立即返回 `202 {taskId, status:QUEUED}`；
  后台 worker 执行现有 `ExternalScanService.scan`，任务态 `QUEUED→RUNNING→SUCCEEDED/PARTIAL/FAILED`
  （PARTIAL 复用 `ScanBatchStatus`）。`GET /api/v1/scan-tasks/{id}` 返回结构化状态 + 每扫描器失败原因；
  `GET /api/v1/scan-tasks/{id}/findings?page=&size=` 分页取归一化报警。同步老端点保留不破坏。
- **验收标准**：
  - [x] 提交返回 taskId，状态从 QUEUED 走到终态
  - [x] 单扫描器失败 → 任务 PARTIAL，其余结果仍可查询/导出
  - [x] findings 分页；失败原因结构化（非纯堆栈文本）
- **验证方式**（已实现）：
  - `ScanTaskStoreTest`（真实 SQLite，状态迁移 + 去重分页）
  - `DefaultScanTaskServiceTest`（同步 executor 驱动 submit/runTask，含 asset 缺失与 scan 抛异常路径）
  - `ScannerControllerTest`（`@WebMvcTest` 契约：202 提交、状态每扫描器摘要、分页、404）
- **落点**：`com.repograph.core.scanner.{ScanTask,ScanTaskStatus,ScanTaskService,ScanTaskFindingsPage,
  ScanTaskNotFoundException}`；`com.repograph.scanner.{ScanTaskStore,DefaultScanTaskService,ScannerAsyncConfig}`；
  端点并入 `ScannerController`（复用其 option 解析），`ScanTaskNotFoundException → 404`。

### T10-2　任务取消 ✅ 已完成（2026-08-01）

- **类型**：AFK
- **被阻塞于**：T10-1
- **覆盖验收**：CANCELLED 状态、主动取消
- **要构建什么**：`POST /api/v1/scan-tasks/{id}/cancel`。QUEUED 任务永不启动 → `CANCELLED`；
  RUNNING 任务中断执行线程，经 `CliProcessRunner` 的 `InterruptedException` 分支 `destroyForcibly`
  在跑的扫描器子进程 → `CANCELLED`；终态任务取消是幂等 no-op。
- **验收标准**：
  - [x] QUEUED 取消 → CANCELLED，不产生 `scanner_runs`（`markRunning` 随后失败，永不执行）
  - [x] RUNNING 取消 → 中断 worker 杀子进程，任务 CANCELLED，已完成扫描器结果保留
    （`DefaultExternalScannerService` 在循环内逐个 `runStore.save`）
- **验证方式**（已实现）：`ScanTaskStoreTest`（cancelIfQueued/cancelIfRunning 条件迁移）、
  `DefaultScanTaskServiceTest`（cancelQueued 阻止 scan 调用；cancelRunning 用后台线程 + latch
  验证 worker 被中断且终态保持 CANCELLED）、`ScannerControllerTest`（cancel 200/404 契约）。
- **落点**：`ScanTaskStore.cancelIfQueued/cancelIfRunning`；`DefaultScanTaskService` 增 `running`
  注册表（taskId→Thread）+ `cancel()`，`runTask` finally 清中断标志；`ScanTaskService.cancel`；
  `ScannerController` 增 `POST /scan-tasks/{id}/cancel`。

### T10-3　并发配额与调度（全局 / 项目 / 扫描器级）

- **类型**：AFK
- **被阻塞于**：T10-1
- **覆盖验收**：全局/项目/扫描器级并发限制
- **要构建什么**：有界 worker 池 + 全局并发上限；项目级、扫描器级在飞上限；超额任务留在 QUEUED
  直到有空位，按入队顺序排空。配额可配（`repograph.scanner.quota.*`）。
- **验收标准**：
  - [ ] 提交 N > 上限 的任务，同时 RUNNING ≤ 上限，其余 QUEUED
  - [ ] 项目级、扫描器级上限独立生效，不互相饿死
- **验证方式**：并发提交计数断言（RUNNING 峰值不超限，最终全部排空）

### T10-4　幂等重试

- **类型**：AFK
- **被阻塞于**：T10-1
- **覆盖验收**：重试不重复写入 finding
- **要构建什么**：`POST /api/v1/scan-tasks/{id}/retry` 对 FAILED/PARTIAL 任务只重跑未成功的扫描器，
  靠现有 `(project_id, fingerprint)` 幂等保证 finding 不重复写；记录 attempt 计数。
- **验收标准**：
  - [ ] 让某扫描器失败 → 重试后成功，findings 无重复，attempt +1
  - [ ] 已 SUCCEEDED 的扫描器重试时跳过，不重复执行
- **验证方式**：重试前后 findings 计数不变 + attempt 断言

### T10-5　Slither 适配器 + 无 Solidity 索引时标记上下文不可定位

- **类型**：AFK（归一化/标记逻辑 fixture 驱动；真跑 slither 需装 slither/solc，同 CodeQL 走 UNAVAILABLE 语义）
- **被阻塞于**：无（可与 T10-1 并行；适配器直接插现有 `ExternalScanService`）
- **覆盖验收**：Slither 归一化为 `ExternalFinding`；缺 Solidity 索引明确标记不可定位
- **要构建什么**：`SlitherScannerAdapter`（`ScannerAdapter`）：跑 slither JSON → 归一化为 `ExternalFinding`；
  项目无 Solidity 索引时给报警打「上下文不可定位」标记（写 `omittedReasons`/标志），不伪造定位；
  能力探测缺工具 → `UNAVAILABLE`。
- **验收标准**：
  - [ ] slither 样例 JSON → `ExternalFinding`（tool/ruleId/cwe/severity/位置/指纹）
  - [ ] 无 Solidity 索引 → 明确标记不可定位，不编造 filePath/line
  - [ ] slither/solc 缺失 → 能力探测 `UNAVAILABLE`（非「零报警成功」）
- **验证方式**：`SlitherFindingImporterTest`（样例 JSON）+ 无索引路径的标记断言

---

## 推荐执行顺序

```
T10-1（脊柱） → T10-2（取消） → T10-3（配额调度） → T10-4（重试）
                                          T10-5（Slither）全程可并行
```

**完成信号（对齐里程碑 M6）**：多项目、多扫描器任务可限流、取消、重试并容忍部分失败。

## 范围外（承接主计划「暂不纳入近期范围」）

- 不在主服务进程内构建或执行不可信项目（含需 autobuild 的 CodeQL 语言、Solidity 编译）。
- 无 Solidity 解析/索引前不提供 Solidity 调用图、污点或定位承诺（T10-5 仅做归一化 + 不可定位标记）。
- 多租户隔离、跨节点分布式队列不在本批范围。

# 优化路线与索引一致性记录（2026-10 合并）

> 本文件合并自三份文档：`optimization-roadmap-2026-10-03.md`（调研）、
> `optimization-validation-2026-10-03.md`（本轮验证记录）、`index-consistency-validation.md`
> （跨存储一致性切片记录），原文已于 2026-10-16 删除。最终领域行为以 [CONTEXT](../../CONTEXT.md)
> "索引管道"一节为权威；本文只保留路线结论、已验证证据和未完成边界。

## 决策建议（2026-10-03 调研结论）

下一阶段围绕一个交付目标：**对现有扫描报警给出可信、可重现、可人工确认的研判结果，并证明它减少了审核时间。**

| 顺位 | 优先级 | 建议交付 | 状态（2026-10-16） |
|---|---|---|---|
| 1 | P0 | 固定标注集、失败覆盖率与版本对比报告 | 部分落地（LlmAdvisoryEvaluator、RuleEffectEvaluator；仍缺完整评估分母与固定人工金标） |
| 2 | P0 | 跨存储删除/更新一致性与故障重试闭环 | 第一片已落地（见下），剩余切片见"一致性保证范围" |
| 3 | P0 | 外部工具能力、导入完整性和执行边界契约 | 已落地（能力探测 UNAVAILABLE、PARTIAL 状态、指纹幂等） |
| 4 | P1 | 分阶段性能预算与受质量约束的优化 | 未开始；应由剖析决定，先建埋点与基线 |
| 5 | P1 | 安全团队试用；通过后接入一个 CI 场景 | 未开始；试用材料见 `.scratch/codesec-triage-agent/TRIAL-PROTOCOL.md` |

## 第一轮已落实修改（基线 `123ce44`，分支 `codex/reliability-performance-20261003`）

| 位置 | 修复后的行为 |
|---|---|
| `DefaultIndexPipeline` | 仅清理确认已不存在或已变成目录的路径；被语言/排除规则过滤 ≠ 已删除 |
| `IncrementalIndexCache` 与索引入口 | 解析前捕获指纹，完成后核对并提交原快照；变化/消失/读取失败时失效缓存、报告 partial |
| 扫描服务 | 扫描器内多语言 PARTIAL 不再汇总为 SUCCEEDED；只重试未完全成功的扫描器 |
| `DefaultScanTaskService` | RUNNING 已落库、线程未登记窗口的取消不遗漏；取消中断与线程注销同步 |
| `RepographApiClient` | GET/POST/JSON POST 统一 `repograph.timeout-seconds`；中断异常恢复线程中断标记 |
| 测试夹具 | 字节码用例临时目录独立编译 fixture；Qdrant 集成测试按 YAML gRPC 配置、独立 UUID 集合 |
| Gradle | ASM/gRPC 强制版本移入 Version Catalog（9.10.1 / 1.63.0，不做未验证升级） |

## 一致性切片行为保证

- `CodeGraph.replaceFiles` 单 Neo4j 事务内清除过期节点/旧出边/旧属性再写入；稳定 ID 节点原位更新并保留外部入边。
- 增量解析失败不预删图或向量，报错并保留 dirty 标记；成功解析的空文件也参与替换。
- `file_cache.md5` 空字符串是持久 dirty 标记；文件删除先登记 dirty 再依次清理图、向量，全部成功才移除。
- `IndexStore.withProjectMutation` 统一同一 JVM 内可重入项目变更边界，覆盖索引、文件清理、HTTP 项目删除和资产删除。
- SQLite 状态写入/枚举失败显式报错；`pending_project_deletions` 保证未完成删除可幂等重试。

## 验证证据（2026-10-03）

`./gradlew test build --continue` 退出码 0：repograph-app 861 通过 / 0 失败 / 14 跳过，
repograph-mcp 29 通过 / 0 失败 / 0 跳过。15 个新增回归先在旧实现上按预期失败再修复通过。
跳过项为 `QdrantVectorStoreIT` 12 例与 `CodeRetrievalBenchmark` 2 例（本机 Docker 未运行），
不计入集成或检索质量达标。真实 MCP jar 冷启动 + initialize + tools/list 验证通过（23 个工具，stdout 纯 JSON）。
未取得真实扫描器、性能基准或用户试用结果。

## 一致性保证范围与后续独立切片

这是单 app 进程内的串行化与持久重试机制，**不是** Neo4j/Qdrant/SQLite 分布式事务；
图成功、向量失败期间仍可能暂时不一致，查询读路径无代际切换或 dirty 过滤；未做真实进程 kill 故障注入。

1. 异步 HTTP 索引完成后的状态/历史写入与项目删除的竞争仍需单独覆盖（防止已删除项目的历史被迟到回调重写）。
2. 在真实 Qdrant 上验证保留 ID 清理、项目隔离和故障恢复；增加真实进程中断注入。
3. 按既有路线建设固定人工金标、完整评估分母及阶段性能基线，再选择性能热点优化。

## 架构深化候选（未实施，需反例与验证决定）

索引变更协调器（集中图/向量/缓存进度与幂等策略）、批次导入结果契约（隐藏 SARIF/Semgrep 差异）、
固定评估执行器（可重放评估）、检索候选提供者（隐藏全量扫描实现）、扫描执行策略（集中资源预算与取消清理）。
成功标准是"减少调用者必须知道的细节"，不把长类拆成更多薄包装；已有 `TriageWorkflow`、`IndexStore`、
`ScannerAdapter` 是优先深化的接缝。

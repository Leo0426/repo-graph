# T11-2 规则效果评估:六类指标 + 版本间回归

Status: resolved

## 背景

T11-1 已交付规则版本化脊柱(`RuleRegistry`/`RuleRegistryStore`,发布闸门 + 回滚 + 审计),但已发布规则
没有任何效果度量:命中了多少报警、多少被人工确认为真、多少被驳回为误报、多少被抑制、多少连代码
上下文都没定位到。没有这组数字就无法回答"这条规则值不值得留、新版本是否比旧版本更好"。
本片对应 [T11 拆分](../../../docs/generated/t11-rule-intelligence-breakdown.md) 的 T11-2,
类型 AFK,被阻塞于 T11-1(已完成)。

## 指标定义与数据来源(全部为既有事实源,不复制事实)

评估对象:单个 `DetectionRule` 版本(`ruleId` + `version`,来自 `rule_registry`)。
关联锚点:`review_queue_entries.rule_id` + `fingerprint`(`ReviewQueueStore`,已有索引
`idx_review_queue_lookup`)。**已知缺口**:研判产物只记 `rule_id` 不记注册规则 `version`
(`rule_version` 列是研判启发式版本,非注册版本),因此本片的版本回归用**评估快照序列**实现(见下)。

| 指标 | 定义 | 数据来源 |
|------|------|----------|
| 命中数 hits | 该 `ruleId` 在评估范围内的去重 fingerprint 数 | `review_queue_entries` |
| 确认数 confirmed | 人工反馈 `TRUE_POSITIVE` + `FIXED` 的命中数 | `triage_feedback`(PK: project_id+fingerprint) |
| 误报数 falsePositives | 人工反馈 `FALSE_POSITIVE` 的命中数 | `triage_feedback` |
| 确认率 confirmationRate | confirmed / (confirmed + falsePositives);分母为 0 时指标不存在,不输出 0% | `triage_feedback` |
| 误报率 falsePositiveRate | falsePositives / (confirmed + falsePositives) | 同上 |
| 抑制率 suppressionRate | 命中 fingerprint 中路径匹配任一 active 且未过期 `RuleSuppression`(ruleId 相等,scope PROJECT 或 FILE_GLOB 路径命中)的比例 | `rule_suppressions` + findings 路径 |
| 无上下文率 noContextRate | 研判报告 `omittedReasons` 含上下文定位失败类原因的命中占比 | `report_snapshots.reports_json`(Jackson 流式解析) |
| NEEDS_REVIEW 数 needsReview | 无明确人工结论、仍需复核的命中数(不进确认/误报分母,单独展示) | `triage_feedback` 或 entries 状态 |

评估范围:`projectId` 必选(指标始终在项目内计算,与研判管道一致)。

## 版本间回归(设计决策)

`review_queue_entries` 不携带注册规则 version,无法把历史命中归属到 v1/v2。本片采用**评估快照序列**:

- 每次评估把完整 `RuleEvaluationReport` 持久化为快照(SQLite `rule_evaluations` 表,含生成时间与
  当时 active 的规则 version);
- `RuleEvaluationReport.regression` = 与上一份快照的每类指标差值(绝对值 + 百分比变化);
- 连续快照的 version 序列天然形成 v1 → v2 的回归视图;
- **局限(显式记录,不伪装)**:快照间的时间窗内可能混入旧版本产生的命中,精确归属需未来把注册
  version 前置写入研判产物(另开工单,不在本片)。

## 交付

- core 契约(`com.repograph.core.finding`):`RuleMetricSet` / `RuleEvaluationReport` /
  `RuleEffectEvaluator` 接口;指标计算为**纯函数**(输入事实集合 → 输出指标),利于 TDD,与
  T11-1 发布闸门同风格
- 实现(`com.repograph.finding`):`DefaultRuleEffectEvaluator`(纯计算)+ `RuleEvaluationStore`
  (SQLite 快照表,幂等 schema)+ 抑制路径 glob 匹配复用 `RuleSuppressionStore` 既有语义
- REST(`RuleController` 扩展):
  - `GET /api/v1/rules/{ruleId}/evaluation?projectId=...` — 即时计算 + 持久化快照,返回报告
  - `GET /api/v1/rules/{ruleId}/evaluations?projectId=...` — 快照列表(版本回归视图)
- 规则未发布/无命中时返回空指标集与 `omittedReasons`,不伪装成 0% 结论

## 验收标准

- [x] 给定构造的 entries + feedback + suppressions + snapshots → 六类指标计算正确
      (含:无反馈时分母不存在、NEEDS_REVIEW 不进分母、FIXED 计入确认)
- [x] 抑制匹配遵守 active + 未过期 + FILE_GLOB 路径语义,PROJECT scope 全命中
- [x] 无上下文率从快照 reports_json 得出,快照/报告缺失进 omittedReasons 不抛异常
      (实现说明:用 TriageReport.located 字段判定,比解析 omittedReasons 字符串更可靠)
- [x] 连续两次评估(中间翻转 active 版本)→ 回归增量字段正确展示每类指标差
- [x] 快照持久化后可列表查询,重启不丢失(跨 store 实例验证)
- [x] 规则不存在 → 404;规则存在但零命中 → 200 + 空指标 + omittedReasons 说明

## 验证方式

`RuleEffectEvaluatorTest`(纯函数指标 + 回归增量)、`RuleEvaluationStoreTest`(快照幂等 + 列表)、
`RuleControllerTest` 扩展(两个端点契约)。命令:`./gradlew :repograph-app:test`;
报告实际结果,区分失败/跳过/通过。

## 范围外

- 不把注册 version 前置写入研判产物(见"版本间回归"局限,未来单开工单)
- 不做 Web 看板页(本片只出 REST;看板留给后续片)
- 不自动评估全部规则(按 ruleId 显式触发;批量调度留给扫描编排后续)
- 不接 T11-4 外部情报

## 评论

- 2026-10-12:第一片落地——core 契约(`RuleMetricSet`/`RuleMetricDelta`/`RuleEvaluationHit`/
  `RuleEvaluationRequest`/`RuleEvaluationReport`/`RuleEffectEvaluator`)+ 纯函数实现
  `DefaultRuleEffectEvaluator` + `DefaultRuleEffectEvaluatorTest`(6 用例全过)。抑制匹配复用
  `RuleSuppressionStore.matchesScope`(private → 包内可见,同包无新抽象)。剩余:评估快照存储、
  REST 两个端点、回归视图持久化。GitHub 同步跳过(gh 未登录)。全量回归:931 tests,
  6 failures 为既有 Windows 环境失败(WatchControllerTest 路径分隔符 ×1、scanner 适配器
  UnsupportedOperationException ×5,已用 stash 前代码复跑确认与本片无关),16 skipped。
- 2026-10-13:第二片落地,T11-2 完成——`RuleEvaluationStore`(SQLite `rule_evaluations` 表,
  幂等建表,save/list/latest)、`RuleEffectEvaluationService`(事实装配:审核队列命中 →
  快照内报告补 filePath 与 located 信号 → 反馈/抑制 → 纯函数评估 → 快照持久化;无 active 版本
  回退最高版本并记 omittedReasons)、`RuleController` 新增
  `GET /{ruleId}/evaluation` 与 `GET /{ruleId}/evaluations`。设计偏离一处:无上下文率改用
  `TriageReport.located` 判定(非解析 omittedReasons 字符串),语义等价且更可靠。
  测试:新增 14 用例全过(Store 4 / Service 4 / Evaluator 7 / Controller 契约 3 新增);
  全量回归 942 tests,6 failures 与改动前完全一致(既有 Windows 环境失败),2 skipped。
  "无 active 版本"分支为防御性逻辑(公共 API 无法构造该状态),已在测试内注释说明。

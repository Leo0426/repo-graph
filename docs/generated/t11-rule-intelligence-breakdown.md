# T11 规则情报、回归集和效果评估闭环 — 任务拆分

> 来源：`docs/generated/next-development-plan-audit-platform.md` 的 T11（P1，被阻塞于 T5、T9，均已完成）。
> 拆分方式：垂直切片（tracer bullet），每片端到端可验证。
> 基线：规则目前在 `CodeVulnScanner` 中硬编码为 `List<Rule>`（ruleId/cwe/severity/title/pattern），
> 无元数据、版本或生命周期。已有可复用件：`RuleSuppressionStore`（生命周期 + 审计表模式）、
> `LlmAdvisoryEvaluator`（标注样本算准确率）。

## 领域新词

| 术语 | 含义 |
|------|------|
| `DetectionRule` | 统一规则元数据：来源、适用语言/框架、CWE、版本、状态、正负测试样本、变更说明、matcher |
| `RuleStatus` | `CANDIDATE → IN_REVIEW → PUBLISHED / REJECTED / ROLLED_BACK` |
| `RuleRegistry` | 规则版本化存储 + 生命周期 + 发布闸门 |
| `RuleRegressionSet` | 规则自带的正样本（必须命中）+ 负样本（必须不命中） |
| `RuleEvaluationReport` | 命中数、确认率、误报率、抑制率、无上下文率、版本间回归 |
| `RuleFormatter` | 从统一元数据生成 Semgrep / source-sink 目标格式 |

领域模型置于 `com.repograph.core.finding`（或新 `core.rule`），存储/实现在 `com.repograph.finding`，
与既有分层一致。

## 决策默认（已定，可推翻）

- **MVP 的规则 matcher 用正则/子串 pattern**（对齐现有 `CodeVulnScanner.Rule`），回归样本用内联代码片段。
  发布闸门即纯函数，利于 TDD。source-sink 类 matcher 作为可扩展的第二种 kind，先不接完整索引/扫描管道。

---

## 任务拆分

### T11-1　规则注册 + 生命周期 + 回归集闸门发布 + 版本化/回滚（MVP 脊柱）

**状态：已完成（2026-08-01）。**

- **类型**：AFK（机器）/ HITL（评审 approve 是人的动作，API 建模但决定在人）
- **被阻塞于**：无
- **要构建什么**：规则以 `CANDIDATE` 带全元数据入库；**发布受回归集闸门**——规则 matcher 跑其正样本
  必须全部命中、负样本必须全部不命中，通过才 `PUBLISHED` 并打版本；支持回滚到上一版本。
  REST：建候选、提交评审、发布（闸门）、回滚、查询/列表。
- **验收标准**：
- [x] 正样本命中 + 负样本不命中 → 发布成功并打 v1
- [x] 弄坏一个样本（正样本不命中或负样本命中）→ 发布被拒，规则不进入 PUBLISHED
- [x] 回滚 → 上一版本重新生效，状态与版本可查
- [x] 每次生命周期迁移记录操作者/时间/理由（审计）
- **验证方式**：`RuleRegistryStoreTest`（闸门通过/拒绝、版本、回滚、审计）、`RuleControllerTest`（契约）

完成实现使用 `RuleRegistryStoreTest` 命名；`./gradlew :repograph-app:test` 全量 962 个测试通过
（19 skipped）。

### T11-3　规则格式化导出（Semgrep / source-sink）

- **类型**：AFK
- **被阻塞于**：T11-1
- **要构建什么**：`RuleFormatter` 从统一 `DetectionRule` 元数据生成 Semgrep YAML 和 source-sink
  JSON/XML，保留统一元数据（id/cwe/version）为注解，不同目标格式共享同一份规则元数据。
- **验收标准**：
  - [ ] 一条规则 → Semgrep YAML（id/pattern/severity 正确）
  - [ ] 同一条规则 → source-sink JSON（source/sink 定义 + 统一 id/cwe/version 注解）
  - [ ] 两种格式来自同一元数据，改元数据两者同步变化
- **验证方式**：`RuleFormatterTest`（两种目标格式快照 + 元数据一致）

### T11-2　效果评估看板

- **类型**：AFK
- **被阻塞于**：T11-1
- **要构建什么**：对已发布规则/版本在标注集 + 历史报警上计算命中数、确认率、误报率、抑制率、
  无上下文率，以及**版本间回归**（v_n vs v_{n-1} 指标差）。复用 `TriageFeedbackStore`、
  `RuleSuppressionStore`、`VulnStore` 与 `LlmAdvisoryEvaluator` 模式。
- **验收标准**：
  - [ ] 给定标注 + 反馈 → 六类指标计算正确
  - [ ] v1 vs v2 显示每类指标的回归增量
- **验证方式**：`RuleEvaluatorTest`（指标计算 + 版本对比）

### T11-4　外部情报候选区 + 许可检查 + 人工评审门

- **类型**：HITL（许可检查 + 人工评审是硬门）
- **被阻塞于**：T11-1
- **要构建什么**：外部漏洞情报/历史案例先进**候选区**；许可检查 + 人工评审 + 正负测试通过前不得发布；
  **绝不把爬取文本自动变成生产规则**（承接主计划「暂不纳入范围」第 5 条）。
- **验收标准**：
  - [ ] 外部情报 → 候选，携带来源与许可信息
  - [ ] 未过许可检查或未经人工评审 → 不可发布
  - [ ] 强制走候选 → 评审 → 测试 → 发布路径，跳步被拒
- **验证方式**：`IntelCandidateTest`（许可门 + 评审门阻断未审情报）

---

## 推荐执行顺序

```
T11-1（脊柱） → T11-3（格式化，小） → T11-2（评估） → T11-4（情报 + HITL 门）
```

**整体验收（计划要求）**：≥2 条规则走完「候选 → 评审 → 测试 → 发布 → 评估 → 回滚」全流程。

## 范围外（承接主计划「暂不纳入近期范围」）

- 不自动抓取/复制/发布第三方规则库内容；外部情报只进候选区，须人工评审 + 许可检查。
- 不追求完整语义克隆检测；不替代 Semgrep/CodeQL 的规则引擎，只做统一元数据 + 目标格式导出。

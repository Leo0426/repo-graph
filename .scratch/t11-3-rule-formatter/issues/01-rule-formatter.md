# T11-3 规则格式化导出:统一元数据 → Semgrep YAML + source-sink JSON

Status: ready-for-agent

## 背景

T11-1/T11-2 已交付规则注册与效果评估,但 `DetectionRule` 元数据无法导出为外部工具格式——
规则不能被 Semgrep 等引擎直接消费,也不能以标准 source-sink 形态对接其它研判设施。
本片对应 [T11 拆分](../../../docs/generated/t11-rule-intelligence-breakdown.md) 的 T11-3,
类型 AFK,被阻塞于 T11-1(已完成)。

## 要构建什么

`RuleFormatter`(契约置于 `com.repograph.core.finding`,实现置于 `com.repograph.finding`,
与 T11 既有分层一致):从同一条 `DetectionRule` 生成两种目标格式,统一元数据
(ruleId/version/cwe/severity/languages/frameworks/source)作为两种格式的公共注解保留。

**格式映射(决策默认,可推翻):**

| DetectionRule 字段 | Semgrep YAML | source-sink JSON |
|---|---|---|
| ruleId | `id` | 顶层 `ruleId` |
| version | `metadata.repograph-version` | 顶层 `version` |
| cwe | `metadata.cwe` | 顶层 `cwe` |
| severity | HIGH/CRITICAL→`ERROR`,MEDIUM→`WARNING`,LOW→`INFO`,UNKNOWN→`WARNING`(显式映射,测试锁定) | 原样输出枚举名 |
| matcherKind=REGEX | `pattern-regex` | `sinks[0].pattern` |
| matcherKind=SUBSTRING | `pattern`(字面量) | `sinks[0].pattern` |
| languages/frameworks/source | `metadata.repograph-*` | 顶层对应字段 |

- Semgrep YAML 用 SnakeYAML(已在依赖树)生成,键序确定性排序,不做漂亮的注释。
- source-sink JSON 结构为可扩展骨架:`{"sources": [...], "sinks": [{"pattern": ...}]}`;
  本片 matcher 只有 REGEX/SUBSTRING(无真实 source 概念),`sources` 恒为空数组——
  结构先立住,source-sink 类规则(kind 扩展)未来填充,不假装有数据流定义。
- 两种格式出自同一 `DetectionRule` 入参,不做任何各自维护的副本。

## 交付

- core:`RuleFormatter` 接口(`String toSemgrepYaml(DetectionRule rule)` /
  `String toSourceSinkJson(DetectionRule rule)`)
- impl:`DefaultRuleFormatter`(纯函数,无 IO)
- REST:**不在本片**(导出入口是编程 API;若试用需要 HTTP 出口,另行小片)

## 验收标准

- [ ] 一条 REGEX 规则 → Semgrep YAML:`id`/`pattern-regex`/severity 映射正确,metadata 注解齐全
- [ ] 一条 SUBSTRING 规则 → Semgrep YAML:`pattern` 为字面量,与 REGEX 走不同键
- [ ] 同一条规则 → source-sink JSON:结构含 `sources`/`sinks` 与统一 id/cwe/version 注解
- [ ] 元数据一致性:两条仅 version 或 severity 不同的规则,两种格式的对应字段同步变化
- [ ] UNKNOWN severity 走显式回退映射(测试锁定,不静默)
- [ ] 生成物是确定性文本(同输入两次生成逐字节一致)

## 验证方式

`RuleFormatterTest`(YAML/JSON 快照断言 + 两规则元数据一致性对比)。
命令:`./gradlew :repograph-app:test`;报告实际结果,区分失败/跳过/通过。

## 范围外

- 不自动接入外部情报、不做规则效果评估(T11-2 已完成)、不替换 `CodeVulnScanner` 内置规则
- 不生成 XML(source-sink 的 XML 形态需求不明确,JSON 先行;需要时另开小片)
- 不做 REST 导出端点

## 评论

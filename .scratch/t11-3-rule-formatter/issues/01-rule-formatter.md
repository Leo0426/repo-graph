# T11-3 规则格式化导出:统一元数据 → Semgrep YAML + source-sink JSON

Status: resolved

## 背景

T11-1/T11-2 已交付规则注册与效果评估,但 `DetectionRule` 元数据无法导出为外部工具格式——
规则不能被 Semgrep 等引擎直接消费,也不能以标准 source-sink 形态对接其它研判设施。
本片对应 [T11 拆分](../../../docs/generated/t11-rule-intelligence-breakdown.md) 的 T11-3,
类型 AFK,被阻塞于 T11-1(已完成)。

## 要构建什么

`RuleFormatter`(契约置于 `com.repograph.core.finding`,实现置于 `com.repograph.finding`,
与 T11 既有分层一致):从同一条 `DetectionRule` 生成两种目标格式,统一元数据
(ruleId/version/cwe/severity/languages/frameworks/source)作为两种格式的公共注解保留。

**格式映射（2026-10-22 核对目标引擎后修订）：**

| DetectionRule 字段 | Semgrep YAML | source-sink JSON |
|---|---|---|
| ruleId | `id` | 顶层 `ruleId` |
| version | `metadata.repograph-version` | 顶层 `version` |
| cwe | `metadata.cwe` | 顶层 `cwe` |
| severity | HIGH/CRITICAL→`ERROR`,MEDIUM→`WARNING`,LOW/INFO→`INFO`,UNKNOWN→`WARNING`(显式映射,测试锁定) | 原样输出枚举名 |
| matcherKind=REGEX | `pattern-regex`：前置 `(?s-m)` 对齐注册表 DOTALL、默认关闭 MULTILINE | `sinks[0].pattern` 原文，附 `matcherKind/regexEngine/regexFlags` |
| matcherKind=SUBSTRING | `pattern-regex`：PCRE2 的 `\Q…\E` 字面引用，处理输入自身含 `\E` 的情况 | `sinks[0].pattern` 原文，附 `matcherKind=SUBSTRING` |
| languages/frameworks/source | `metadata.repograph-*` | 顶层对应字段 |

- Semgrep YAML 用 SnakeYAML(已在依赖树)生成,键序确定性排序,不做漂亮的注释。
- source-sink JSON 结构为可扩展骨架:`{"sources": [...], "sinks": [{"pattern": ...}]}`;
  本片 matcher 只有 REGEX/SUBSTRING(无真实 source 概念),`sources` 恒为空数组——
  结构先立住,source-sink 类规则(kind 扩展)未来填充,不假装有数据流定义。
- 两种格式出自同一 `DetectionRule` 入参,不做任何各自维护的副本。
- Semgrep 输出是完整 `rules` 文档，同时填充必需的 `message`（来自 title）和 `languages`；
  metadata 保留原始 matcher 类型、表达式与 REGEX 的源引擎标识。
- 修订依据：[Semgrep pattern 是代码结构匹配，pattern-regex 才是文本匹配](https://docs.semgrep.dev/writing-rules/rule-syntax)；
  [PCRE2 支持字面引用](https://www.pcre.org/current/doc/html/pcre2syntax.html)。
  原默认 SUBSTRING→pattern 会把 `$X/...` 当语法，或因任意片段无法解析而失败，不能保留 String.contains。
- Java REGEX 与 PCRE2 并非完全同一方言；本片对齐默认 flags，保留原文与源引擎说明，
  不宣称完成所有正则方言转换。接入方应在目标 Semgrep 版本校验规则及正负样本。

## 交付

- core:`RuleFormatter` 接口(`String toSemgrepYaml(DetectionRule rule)` /
  `String toSourceSinkJson(DetectionRule rule)`)
- impl:`DefaultRuleFormatter`(纯函数,无 IO)
- REST:**不在本片**(导出入口是编程 API;若试用需要 HTTP 出口,另行小片)

## 验收标准

- [x] 一条 REGEX 规则 → Semgrep YAML:`id`/`pattern-regex`/severity 映射正确,metadata 注解齐全
- [x] 一条 SUBSTRING 规则 → Semgrep YAML:`pattern-regex` 进行字面转义，特殊字符不会变成 matcher 语法
- [x] 同一条规则 → source-sink JSON:结构含 `sources`/`sinks` 与统一 id/cwe/version 注解
- [x] 元数据一致性:两条仅 version 或 severity 不同的规则,两种格式的对应字段同步变化
- [x] UNKNOWN severity 走显式回退映射(测试锁定,不静默)
- [x] 生成物是确定性文本(同输入两次生成逐字节一致)

## 验证方式

`RuleFormatterTest`(YAML/JSON 快照断言 + 两规则元数据一致性对比)。
命令:`./gradlew :repograph-app:test`;报告实际结果,区分失败/跳过/通过。

`RuleFormatterSemgrepIT` 对真实 Semgrep CLI 执行导出文件，验证 REGEX 的 DOTALL/非多行锚点及
SUBSTRING 的字面匹配。用 `-Dtest.semgrep.command=/absolute/path/to/semgrep` 显式配置；
未配置时跳过，配置后失败必须报错。CLI 只扫描临时样本，关闭遥测和版本检查，读取本地规则。

## 范围外

- 不自动接入外部情报、不做规则效果评估(T11-2 已完成)、不替换 `CodeVulnScanner` 内置规则
- 不生成 XML(source-sink 的 XML 形态需求不明确,JSON 先行;需要时另开小片)
- 不做 REST 导出端点

## 评论

- 2026-10-22：交付 core `RuleFormatter` 契约、finding `DefaultRuleFormatter` 无 IO 实现；
  SnakeYAML 显式声明为 Version Catalog 依赖，版本由现有 Spring Boot BOM 管理。
- 12 项单测和 2 项真实 Semgrep 1.182.1 集成用例均观察到 RED→GREEN，最终全部通过，零跳过。
  测试覆盖完整目标文档、所有严重程度、元数据变更、原始 matcher 保留、特殊字符/换行、
  非结构化文本注入、字节稳定性及真实引擎的正负样本匹配。
- 完整验收命令：

  ```bash
  ./gradlew test :repograph-app:bootJar :repograph-mcp:bootJar --rerun-tasks \
    -Dtest.semgrep.command=/absolute/path/to/semgrep
  ```

  app：1052 项中 1036 通过、16 跳过、0 失败；MCP：29 通过、0 跳过、0 失败。
  跳过项为 QdrantVectorStoreIT 14 项和 CodeRetrievalBenchmark 2 项，外部依赖环境未满足；
  真实 Semgrep 的 2 项本次已运行通过。两个模块 bootJar 构建通过。
- 独立只读代码审查未发现阻断问题，`git diff --check` 通过。CONTEXT、Validation 和 T11 任务拆分已同步。

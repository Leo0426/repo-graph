Status: resolved

# External Finding 统一模型

## 目标

新增外部 SAST 报警的统一领域模型，用于承载 Semgrep、SARIF、CodeQL、SonarQube 等工具的报警结果。

## 范围

- 定义 `ExternalFinding` 或同等 record
- 字段至少包含：tool、ruleId、cwe、severity、message、filePath、startLine、endLine、symbol、trace、raw
- 不改现有 `VulnFinding` 兼容字段
- 明确 `ExternalFinding` 与 `VulnFinding` 的边界：前者是外部输入，后者是 RepoGraph 内部发现记录

## 验收标准

- [x] 字段有 Javadoc
- [x] 不引入第三方依赖到 core
- [x] 单元测试覆盖必填字段、空 trace、缺失 cwe

## 完成记录

- 新增 `com.repograph.core.finding.ExternalFinding`
- 新增 `ExternalFindingTraceStep`
- 新增 `ExternalFindingSeverity`
- 新增 `ExternalFindingTest`

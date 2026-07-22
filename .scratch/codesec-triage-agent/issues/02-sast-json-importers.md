Status: resolved

# SAST JSON 导入器

## 目标

支持将 Semgrep JSON 和 SARIF JSON 解析为统一 `ExternalFinding`。

## 范围

- Semgrep JSON importer
- SARIF importer
- CodeQL 先通过 SARIF 路径支持
- 解析失败返回可诊断错误，不中断整批导入

## 验收标准

- [x] Semgrep fixture 可解析出 ruleId、severity、filePath、line、message
- [x] SARIF fixture 可解析出 ruleId、level、location、message
- [x] 无效 JSON 返回明确错误
- [x] 测试不依赖网络

## 完成记录

- 新增 `ExternalFindingImporter`
- 新增 `ExternalFindingImportException`
- 新增 `SemgrepFindingImporter`
- 新增 `SarifFindingImporter`
- 新增 Semgrep / SARIF 导入器单元测试

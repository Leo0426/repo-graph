Status: resolved

# Finding Context Builder

## 目标

基于外部报警位置构建可供研判的上下文包。

## 范围

- filePath + line → CodeUnit 定位
- 基于 ruleId / cwe / message 执行 keyword search
- 基于定位 CodeUnit 扩展 callers / callees / impact
- 复用 Context Pack citation 格式

## 验收标准

- [x] 能定位报警所在函数或文档章节
- [x] 找不到 CodeUnit 时返回缺失原因，不抛 500
- [x] Context Pack evidence 包含报警位置证据
- [x] 关键词 evidence 标记为 `KEYWORD`

## 完成记录

- `ContextPackService` 抽出可复用的 `assemble(...)`（预算裁剪 + citation 编号）
- 新增 `com.repograph.core.finding.FindingContext`
- 新增 `com.repograph.finding.FindingContextService`：定位（source=FINDING）→ callers/callees → impact → keyword（source=KEYWORD）
- 定位失败写入 `omittedReasons`，仍返回关键词证据
- 新增 `FindingContextServiceTest`（定位+扩展、缺失原因、去重）
- 顺手修复 `VulnControllerTest` 缺少 `PreciseTaintScanService` mock 导致的既有失败

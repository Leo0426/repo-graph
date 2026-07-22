Status: resolved

# P1 防护信号识别

## 目标

让研判基线识别与 CWE 对应的输入校验、参数化、输出编码、路径规范化和反序列化过滤候选，
避免在已有防护证据时直接确认真实风险。

## 范围

- 从报警定位证据和 CALLEE 证据的源码片段识别 CWE 特定防护候选
- 防护候选必须携带 citation ID
- 敏感操作、调用方和防护候选同时存在时输出 `NEEDS_REVIEW`
- 不把 CALLER 或关键词召回中的无关标记作为防护依据
- 当前只做启发式候选识别，不声称已验证数据流覆盖

## 验收标准

- [x] CWE-78 输入校验候选能改变结论并进入 reasons
- [x] 防护理由包含 citation ID
- [x] CALLER 中的无关防护标记不改变真实风险结论
- [x] 报告明确提示尚未验证防护对 sink 的支配和全路径覆盖
- [x] 行为测试覆盖有防护与跨证据污染路径

## 完成记录

- 新增 `ProtectionSignalDetector`，按 CWE 匹配候选防护模式
- `TriageReportService` 在敏感操作可达且存在候选防护时保守输出 `NEEDS_REVIEW`
- 支持 CWE-78 / CWE-89 / CWE-79 / CWE-22 / CWE-502 的首批启发式模式

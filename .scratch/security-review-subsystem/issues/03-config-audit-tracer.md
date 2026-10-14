# 03 配置核查工具 tracer bullet：安全策略核查端到端

Status: resolved

- 类型：AFK
- 被阻塞于：无
- 覆盖：FR-1（安全策略维度）、dev-plan P1 第一切片

## 要做什么

打通配置核查工具的第一条端到端窄路径：输入一份安全策略/系统配置文件 → 内置核查规则集逐条核查 → 输出结构化核查报告（违规项、依据条款、修复建议）。不做 UI，不做其余维度，先把"文件进、报告出"的路径走通，规则集设计为可扩展。

## 验收标准

- [ ] 提供至少 1 份样例安全策略文件作为测试输入
- [ ] 核查命令端到端可运行，输出结构化报告（JSON 或约定格式），含违规项、依据条款、修复建议
- [ ] 样例文件上至少命中 1 条违规项且报告正确
- [ ] 规则以数据/规则集形式组织，新增一条规则不需要改核查引擎代码
- [ ] 有覆盖命中与未命中两种路径的单元测试，按 [Validation](../../../docs/VALIDATION.md) 走真实 Gradle 检查

## 验证方式

Gradle 测试通过 + 手动对样例文件运行核查并检查报告内容。

## 评论

- 2026-10-14（agent）：已实现。契约 `com.repograph.core.securityreview` + 实现 `com.repograph.securityreview`
  + REST `POST /api/v1/config-audit/reports`；规则即数据（classpath `security-review/rules/security-policy.json`，
  5 条 SECURITY_POLICY 规则，覆盖 PRESENT/VALUE_PATTERN/FORBIDDEN 三类匹配器）。
  验证：`DefaultConfigAuditServiceTest`（14 例）+ `ConfigAuditControllerTest`（2 例）通过
  （`gradlew :repograph-app:test` 退出码 0）。

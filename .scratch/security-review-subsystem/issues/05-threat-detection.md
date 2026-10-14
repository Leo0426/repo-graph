# 05 威胁检测工具：在役装备攻击历史与违规外联记录

Status: resolved

- 类型：AFK
- 被阻塞于：04（复用其日志数据接入路径）
- 覆盖：FR-3、dev-plan P2

## 要做什么

端到端交付在役装备威胁检测：接入日志/流量类数据源（沿用 04 建立的系统日志读取路径）→ 检测两类威胁信号 —— ① 被攻击历史痕迹（如异常登录、扫描探测、暴力破解记录），② 违规外联记录（如连向非授权外部地址的出站连接）→ 输出威胁检测报告。

## 验收标准

- [ ] 样例日志集包含：含攻击历史痕迹、含违规外联记录、正常日志三类
- [ ] 前两类样例各至少检出 1 条威胁记录，报告含时间、证据、威胁类型
- [ ] 正常日志样例零误报
- [ ] 威胁检测规则与核查规则同样以可扩展的规则集组织
- [ ] Gradle 测试通过

## 验证方式

Gradle 测试 + 对三类样例日志各跑一次检测并核对报告。

## 评论

- 2026-10-14（agent）：已实现。契约 `ThreatDetectionService`/`ThreatReport` + 实现
  `DefaultThreatDetectionService` + REST `POST /api/v1/threat-detection/reports`；威胁模式同为
  classpath JSON（`security-review/threat-rules/`，攻击历史 3 条 + 外联 2 条，支持逐行与
  minCount 聚合两类规则）；外联白名单支持精确 IP / CIDR 网段 / 字符串精确匹配
  （`OutboundWhitelist`）。验证：`DefaultThreatDetectionServiceTest`（6 例，含攻击历史检出、
  白名单外目标检出、正常日志零误报）+ `ThreatDetectionControllerTest`（2 例）通过
  （`gradlew :repograph-app:test` 退出码 0）。

# PRD — CodeSec Triage Agent

Status: resolved

## 背景

RepoGraph 当前已经具备代码解析、Hybrid GraphRAG、Context Pack、漏洞管理、污点分析、MCP 工具等基础能力。后续产品主线应从“本地代码知识图谱 / 审计平台”进一步收敛到：

> 面向企业研发安全团队的 AI Native SAST 报警研判与修复 Agent。

第一阶段不从零做扫描器，而是接入现有 SAST / SCA / CI 工具的结果，做报警后的智能研判层。

## 目标用户

| 用户 | 痛点 | 价值 |
|---|---|---|
| AppSec 工程师 | 报警多、误报高、解释成本高 | 自动生成证据链和研判报告 |
| 安全运营人员 | 每天处理大量 SAST 报警 | 降低人工初筛时间 |
| 研发负责人 | 不信安全工具报警 | 用调用链、source/sink、修复建议提高可信度 |
| DevSecOps 团队 | 想把安全嵌入 CI/CD | 后续接入 PR / CI 自动评论 |

## MVP 目标

让用户上传一个 Java / Python 仓库和一份 SAST 报警 JSON，系统自动生成单条或批量报警研判报告：

- 漏洞类型解释
- 是否真实 / 可能误报 / 需人工确认
- 判断依据
- source 到 sink 或相关调用路径
- 相关代码证据和 citation
- 修复建议
- 可复制给研发的 Markdown 报告

## 范围内

- Semgrep / SARIF / CodeQL 报警 JSON 导入
- 外部报警统一模型
- 报警位置到 CodeUnit 的定位
- 基于 GraphRAG / Keyword Search / Context Pack 的上下文组装
- 复用已有 Taint / Vuln / Impact 能力做证据增强
- Markdown / JSON 研判报告
- 人工反馈状态：TRUE_POSITIVE / FALSE_POSITIVE / NEEDS_REVIEW

## 范围外

- 从零实现完整 SAST 引擎
- 自动提交 Patch
- GitHub / GitLab / SonarQube 深度集成
- 企业权限、审计日志、多租户
- 覆盖所有语言

## 核心流程

```text
SAST 报警 JSON + Git 仓库
  ↓
报警归一化
  ↓
定位报警 CodeUnit
  ↓
Context Pack 组装
  ↓
调用图 / 污点 / 依赖 / 关键词证据增强
  ↓
Agent 研判
  ↓
Markdown 报告 + 反馈状态
```

## 验收标准

- [x] 能导入至少一种 Semgrep JSON 样例
- [x] 能导入至少一种 SARIF 样例
- [x] 能通过 file + line 定位报警所在 CodeUnit
- [x] 能为单条报警生成 Context Pack
- [x] 报告包含 citation、文件路径、行号、证据片段
- [x] 报告给出结论：真实 / 误报 / 需人工确认
- [x] 报告包含修复建议
- [x] 人工反馈状态可持久化

## 成功指标

| 指标 | 目标 |
|---|---:|
| 单条报警报告生成耗时 | < 30 秒 |
| 报告证据覆盖率 | 100% 报告包含至少 1 条 citation |
| 试用用户认为节省时间 | ≥ 3/5 |
| Demo 项目数量 | ≥ 3 |

## 参考路线

详见 `docs/generated/roadmap-codesec-triage-agent.md`。

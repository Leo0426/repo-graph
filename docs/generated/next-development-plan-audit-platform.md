# RepoGraph 审计流程能力对齐与下一步开发计划

> 评估日期：2026-07-26；2026-10-16 压缩：已完成任务的逐项验收清单删除（结果记录在
> [CONTEXT.md](../../CONTEXT.md) 与 git 历史），仅保留结论、剩余任务与边界。
> 来源：`docs/generated/roadmap-codesec-triage-agent.md`；T11 细节见
> [T11 拆分](t11-rule-intelligence-breakdown.md)。

## 结论

RepoGraph 已具备"多语言源码索引 → 外部 SAST 报警导入 → 调用图/污点/Context Pack 证据融合 →
启发式研判 → Markdown/JSON/PDF 输出 → 人工反馈"的基础主链路。下一阶段不重写 CodeQL、Semgrep、
Slither 等成熟扫描内核，继续保持"代码智能与报警研判层"定位。输入、检测、研判、交付四个闭环
断点已补齐（T1–T6、T9、T10 完成），剩余为动态验证闭环与规则情报闭环尾段。

## 任务状态总览

| 任务 | 内容 | 状态 |
|---|---|---|
| T1 安全归档接入 | ZIP/TAR.GZ 安全解压 + 复用 IndexPipeline | ✅ 完成（2026-07-26） |
| T2 资产画像与扫描计划 | ProjectAssetProfile + 扫描推荐 | ✅ 完成（2026-07-26） |
| T3 外部扫描编排 | ScannerAdapter + ExternalFinding 归一化 | ✅ 完成 |
| T4 路由—鉴权—资源证据 | Spring 注解合并 + 调用路径资源访问 | ✅ 完成 |
| T5 反馈/路径一致性/变体 | 版本化反馈、规则抑制、路径防护、变体召回 | ✅ 完成 |
| T6 受约束 LLM 辅助复核 | 提供方中立接口 + citation 白名单 + 离线评估 | ✅ 完成（真实模型适配留部署方决策） |
| T7 隔离容器复现漏洞 | 构建→隔离运行时→载荷→证据关联 | ⬜ 未启动（P1 HITL，需人工决策执行边界） |
| T8 无回显与上传链路 | OOB token + 上传证据链 | ⬜ 未启动（P2 HITL，被 T7 阻塞） |
| T9 审核队列与三格式交付 | ReportSnapshot + Markdown/JSON/PDF + 审计 | ✅ 完成（分页/批量导出已补；PDF 视觉回归遗留，见 `.scratch/t9-review-queue-leftovers/issues/03`） |
| T10 批量扫描任务与 Slither | 异步任务、取消、配额、重试、Slither 适配 | ✅ 全部切片完成（2026-08-01） |
| T11 规则情报与效果评估 | DetectionRule 注册/闸门/评估/格式化/情报 | ◐ T11-1、T11-2、T11-3 完成；T11-4 待做（见 T11 拆分） |

## 架构边界（后续实现继续遵守）

1. core 只定义领域模型和接口，不引入第三方依赖；实现放 `repograph-app` 现有能力包。
2. 外部扫描器通过适配器产出 `ExternalFinding`，专有模型不渗入 `VulnFinding`、`ContextPack` 或图存储。
3. `ExternalFinding` 是外部工具事实，`VulnFinding` 是内部发现，状态机不混用。
4. 动态验证必须运行在独立受限进程或容器；主服务只下发任务并接收结构化证据。
5. LLM 只能解释完整的 citation-ready 证据包，输出标记为辅助意见，不能直接把发现变为 `CONFIRMED`。
6. 增加 Solidity `CodeUnit` 解析前，不宣称已支持 Solidity 上下文定位、调用图或污点融合。

## 暂不纳入近期范围

1. 自研替代 CodeQL/Semgrep/Slither 的完整通用扫描内核。
2. 在 RepoGraph 主服务进程内构建或执行不可信代码。
3. 让 LLM、OOB 未回连或单一启发式信号直接决定漏洞最终状态。
4. 未经许可自动抓取、复制或发布第三方规则库内容。

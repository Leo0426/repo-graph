# RepoGraph Glossary

这里只索引 [CONTEXT.md](../CONTEXT.md) 已有概念，详细字段和状态仍在该文件；不把工程行为规则写成术语。

| 术语 | 定义 |
|------|------|
| CodeUnit | 代码符号或文档章节的统一单元，带源码范围、签名、metadata 等信息。 |
| CodeUnitKind | CodeUnit 的种类枚举；DOCUMENT 表示 Markdown 章节。 |
| RelationEdge / EdgeKind | 符号间的关系及关系种类；EXTENDS 表示继承，IMPLEMENTS 表示接口实现。 |
| projectId | 从规范化绝对项目根路径计算的 12 字符 SHA-256 前缀；不是 Git 仓库远端身份。 |
| qualifiedName | 符号限定名；Java 方法含所属类型、方法名和参数列表。 |
| metadata | CodeUnit 的扩展属性；标准 key 定义在 CONTEXT.md。 |
| PRECISE / HEURISTIC / AUTO | 精确解析、启发式解析以及优先精确再降级的解析策略。 |
| ExternalFinding | 来自 SAST/SCA 工具的归一化报警输入事实。 |
| VulnFinding | RepoGraph 内部扫描或研判后的漏洞发现记录，与外部报警输入不同。 |
| Context Pack | 给 Agent 使用的、带预算裁剪和 citation 的证据集合，本身不生成答案或判定事实。 |
| TriageReport | 启发式研判结果，含结论、置信度、上下文和独立决策证据。 |
| ReportSnapshot | 冻结的批量研判结果，报告导出与审核引用的共同来源。 |
| AgentPlaybook | 可版本化的目标工作流，定义步骤、能力、降级和人工检查点。 |
| AgentRun / AgentStep | 一次工作流执行及其中可观察的步骤，保存状态、引用、摘要和结构化错误。 |
| advisoryOnly | 模型输出作为辅助建议的标记，不表示已人工确认的漏洞结论。 |

模型级补充信息和演进继续维护在 CONTEXT.md；新增或修订规范术语需有明确领域证据。

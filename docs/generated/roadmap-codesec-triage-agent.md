# Roadmap — AI Native SAST 报警研判与修复 Agent

> 本路线将 RepoGraph 后续产品主线收敛为：面向企业研发安全团队的 AI Native Code Intelligence / SAST 报警研判与修复 Agent。

## 产品定位

RepoGraph 不从零竞争“完整 SAST 扫描器”，而是作为现有 SAST / SCA / CI 工具之后的智能研判层：

> 接入 CodeQL、Semgrep、SonarQube、Fortify、Checkmarx、SCA、CI/CD、Git 仓库扫描结果，自动分析报警上下文，判断真实风险，生成证据链、修复建议和可审计报告。

### 补充定位：面向编码 Agent 的代码仓库智能层

SAST 报警研判 Agent 是近期收敛的产品主线（面向企业研发安全团队），但 `repograph-mcp` 这层
MCP 工具本身已经具备一个更基础、更通用的定位，且不需要额外大量工程投入就能独立成立：

> 预先建立增量语义索引（调用图 + 向量 + 关键词），让 Codex、Claude Code、Junie 等编码 Agent
> 在处理任意任务时都能直接查询项目知识（调用链、影响面、语义检索、污点路径），而不必每次
> 现场 grep/读文件，也不必启动专门的探索子 Agent 来重建上下文——索引建一次，查很多次。

这条定位的价值主张和 SAST 报警研判 Agent 不同：不是"减少人工安全研判时间"，而是"减少编码
Agent 自己探索代码库的成本"——受众也更广（任意使用编码 Agent 的开发者/团队，不限于 AppSec）。
两条线共享同一套底层能力（`search_semantic`/`search_graphrag`/`find_callers`/`trace_taint` 等
MCP 工具、增量索引管道），区别只是包装和验证对象不同：

| | SAST 报警研判 Agent | 代码仓库智能层 |
|---|---|---|
| 受众 | 企业研发安全团队 | 使用编码 Agent 的开发者/团队 |
| 价值主张 | 减少 SAST 报警人工研判时间 | 减少编码 Agent 探索代码库的成本 |
| 当前状态 | P0 完成 + 4 轮真实样本验证（见 `.scratch/codesec-triage-agent/VALIDATION-METHODOLOGY.md`） | MCP 工具已存在（21 个），未专门验证"减少探索成本"这个假设 |
| 验证方式 | 真实开源项目 + SAST 扫描器结果 | 让编码 Agent（Claude Code/Codex/Junie）接入 MCP，对比"有索引 vs 无索引"完成同一任务的耗时/质量 |

**Why 值得单独列出**：这次真实样本验证过程本身就是证据——四轮验证里挖到的三个 parser/逻辑 bug，
全部是靠"用 `find_callers`/`find_callees` 直接查图核对定位是否正确"发现的；如果没有预建索引，
靠人工/Agent 现场 grep 很难系统性发现"调用图断链""入口点未标记"这类结构性问题。这本身就是
"预建索引降低探索成本"这个价值主张的一个佐证，值得作为独立故事讲。

**How to apply**：这条定位不需要新的工程任务就能开始验证——下一步是设计一个对比实验
（同一个真实任务，编码 Agent 分别在"接入 repograph-mcp"和"只用默认工具"两种条件下完成，
比较耗时、grep/读文件次数、结论准确性），而不是急着加新功能。

#### 同类产品参考：JetBrains Context

这条定位不是凭空设想的品类——JetBrains 已经在做类似的事（JetBrains Context 服务器），
可以作为"这个方向真实存在市场需求"的佐证，也是差异化对比的参照系：

| 维度 | JetBrains Context | RepoGraph（对照） |
|---|---|---|
| 解决的问题 | Agent 在大型代码库中花费大量时间和 Token 搜索代码、读取文件、寻找实现范例 | 同（见上"补充定位"的问题陈述） |
| 核心机制 | 对仓库进行增量语义索引，并向 Agent 提供语义搜索工具 | 同样是增量索引，但多一层调用图（Neo4j）+ 污点分析，不只是语义搜索 |
| 检索方式 | 可按问题、概念和相关语义查询，不局限于文件名或关键词 | 语义检索 + 关键词 + 调用图遍历（callers/callees/impact）的 Hybrid GraphRAG |
| 多仓能力 | 能检索组织内多个仓库，包括没有检出到本地的远程仓库 | 目前按 `projectId` 隔离本地已索引项目，**不支持未检出到本地的远程仓库**——明显功能差距 |
| 支持 Agent | Codex CLI、Claude Code、Junie CLI | 任何支持 MCP 协议的客户端（同样覆盖 Codex/Claude Code；Junie 未验证） |
| 隐私说明 | JetBrains 声称源代码不会存储在 JetBrains Context 服务器上 | 自托管（Neo4j/Qdrant 部署在用户自己的基础设施），源码和索引都不离开用户环境，隐私上是更强的默认状态 |

**差异化方向**：JetBrains Context 目前描述的核心机制是"语义索引 + 语义搜索"，RepoGraph 多了
调用图/污点分析/漏洞管理这些结构化能力（这也是这次四轮验证挖 bug 靠的东西，纯语义搜索做不到
"这个方法有没有调用方"这种精确结构性判断）。自托管部署本身也是一个差异化点，而不只是隐私声明。
最大的功能差距是"多仓能力"——JetBrains 支持检索没有检出到本地的远程仓库，RepoGraph 目前要求
先本地索引，这是需要正视的短板，不是可以回避的细节。

## 核心假设

| 假设 | 验证方式 | 成功信号 |
|---|---|---|
| 安全团队愿意为减少 SAST 报警研判时间付费 | 找 AppSec / 安全负责人试用 Demo | 报告能替代或显著缩短人工研判 |
| 研发愿意接受带证据链的安全结论 | 让研发负责人评估报告可读性 | 能理解漏洞路径和修复建议 |
| RepoGraph 的 GraphRAG + 污点 + Context Pack 能提供差异化 | 对同一报警比较“只看单行代码”与“结构化上下文研判” | 误报解释和真实漏洞判断更可信 |

## 当前能力基线

| 能力 | 当前状态 | 对产品的作用 |
|---|---|---|
| 代码解析 | Java / C / Python / Markdown / Java 字节码 | 定位报警代码、函数、类、文档上下文 |
| 图谱 | Neo4j CodeUnit 图、CALLS、EXTENDS、IMPLEMENTS | 调用链、影响面、路径解释 |
| 检索 | 向量 + 轻量关键词 Hybrid GraphRAG | 按规则 ID、CWE/CVE、API 名称和自然语言找上下文 |
| Context Pack | 已有 citation-ready 上下文包 | 给 Agent 提供可溯源证据 |
| 漏洞管理 | CodeVuln / TaintVuln / DepsVuln / PreciseTaint | 作为研判和复核工具 |
| MCP | 23 个工具 | 作为 AI Agent 工具层 |

## 分阶段路线

| 阶段 | 目标 | 交付物 | 验证重点 |
|---|---|---|---|
| P0 报警解释器 | 上传 SAST 报警 + 本地仓库，生成研判报告 | SARIF / Semgrep / CodeQL JSON 导入，报警定位，Context Pack，Markdown 报告 | 用户是否愿意用报告替代人工初看 |
| P1 误报研判 | 判断真实漏洞 / 误报 / 需人工确认 | source/sink 证据链、可达性、已有防护识别、置信度 | 是否减少误报处理时间 |
| P2 PR / CI 集成 | 进入研发流程 | GitHub/GitLab PR 评论、CI 扫描结果自动研判、状态回写 | 是否嵌入真实 DevSecOps 流程 |
| P3 修复闭环 | 从研判走向修复 | Patch 草案、构建/测试/规则复扫、状态机闭环 | 研发是否采纳修复建议 |
| P4 企业化 | 商业化与私有化 | 团队版、项目知识库、企业规则库、权限、审计日志 | 是否满足企业采购要求 |
| P5 平台化 | AI Native Code Intelligence Platform | 代码问答、风险知识库、架构/安全/质量统一分析 | 是否从安全研判扩展为代码智能平台 |

## P0 MVP 范围

| 模块 | MVP 功能 | 说明 |
|---|---|---|
| 报警接入 | Semgrep / CodeQL / SARIF JSON 导入 | 先支持本地上传，不做平台集成 |
| 报警模型 | `SecurityFindingInput` / `ExternalFinding` | 保留 tool、ruleId、cwe、severity、file、line、message、trace |
| 上下文定位 | 通过 file + line 定位 `CodeUnit` | 复用 `locate_at` / `VectorStore.locateByPosition` |
| 证据组装 | 基于报警位置构建 Context Pack | 包括命中函数、调用方/被调用方、关键词命中、污点路径 |
| 研判输出 | Markdown 报告 | 是否真实、为什么、证据、修复建议、需人工确认项 |
| 反馈闭环 | 标记 TRUE_POSITIVE / FALSE_POSITIVE / NEEDS_REVIEW | 先本地 SQLite 保存 |

## P0 不做

| 不做 | 原因 |
|---|---|
| 从零写完整 SAST 引擎 | 周期长，容易与成熟厂商正面竞争 |
| 多平台深度集成 | 先验证单点价值，再做 GitHub/GitLab/Sonar 插件 |
| 自动提交 Patch | P0 先做报告和建议，避免修复不可用导致信任损耗 |
| 覆盖所有语言 | 先聚焦 Java / Python，符合当前能力和用户痛点 |

## 关键工程任务

| 优先级 | 任务 | 说明 |
|---|---|---|
| P0-1 | External Finding 领域模型 | 定义外部 SAST 报警输入与归一化字段 |
| P0-2 | SARIF / Semgrep / CodeQL 解析器 | 将外部 JSON 转为统一报警模型 |
| P0-3 | Finding Context Builder | 从报警位置定位 CodeUnit，扩展调用图、关键词、污点上下文 |
| P0-4 | Triage Report Generator | 输出 Markdown / JSON 研判报告 |
| P0-5 | Feedback Store | 保存人工确认、误报、待复核状态 |
| P0-6 | Web / REST / MCP 入口 | 支持上传报警、生成报告、查询研判结果 |

## 成功指标

| 指标 | MVP 目标 |
|---|---:|
| 单个报警生成报告耗时 | < 30 秒 |
| 报告包含可点击/可定位证据 | 100% |
| 报告包含明确结论或需人工确认原因 | 100% |
| 试用用户认为节省研判时间 | ≥ 3/5 |
| 真实项目 Demo 数 | ≥ 3 个 Java/Python 项目 |

## 风险

| 风险 | 应对 |
|---|---|
| 只用 LLM 导致幻觉 | Agent 只能基于 Context Pack citation 输出结论 |
| SAST 报警格式差异大 | 先统一 SARIF，再针对 Semgrep / CodeQL 做适配 |
| 误报判断不可信 | 输出证据链、置信度、缺失信息，不强行下结论 |
| 上下文成本过高 | 使用 Hybrid Search、调用图扩展、预算裁剪 |
| 企业数据不能出域 | 保持本地部署和私有模型适配方向 |

## 最近下一步

P0“报警解释器”主链路已完成：

1. 已新增外部报警统一模型。
2. 已支持 Semgrep / SARIF / CodeQL JSON，SARIF 支持请求流式导入和数量上限。
3. 已通过 MCP 写入和查询人工研判反馈，形成 SAST 研判闭环。
4. 已对单条报警生成 Context Pack。
5. 已输出 Markdown 研判报告。
6. P1 已开始：研判基线可识别 CWE 特定防护候选，并避免跨 CALLER 证据污染。
7. 下一步用 3-5 个真实报警样本验证防护识别与研判时间，再推进 source/sink 路径一致性校验。

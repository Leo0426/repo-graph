# 竞品能力调研:SAST 研判赛道 + AI 代码智能赛道(2026-10-13)

> 定位:本文是 `forgeflow:discovery` / `forgeflow:decision-forge` 的**输入**,不是决策本身。
> 方法:调研 agent 针对一手来源(官方文档、定价页、changelog、GitHub 仓库)逐条抓取,
> 每条关键论断标注来源 URL;无法验证的论断显式标注"未能验证",不编造。
> 抓取时间:2026-10-12/13。配套背景:[roadmap](roadmap-codesec-triage-agent.md)、
> [DeepMap 设计借鉴](deepmap-design-borrow-2026-10-12.md)、[TRIAL-PROTOCOL](../../.scratch/codesec-triage-agent/TRIAL-PROTOCOL.md)。

---

## 第一部分:SAST 报警研判赛道(5 家)

### 1. GitHub CodeQL / GitHub Advanced Security

**研判/降噪**:人工 triage 为"dismiss + 原因枚举 + 可选评论",评论进 alert timeline 供审计;支持批量 dismiss,dismiss 全分支生效且下次扫描不再报。文档明示 dismiss 原因"可能影响该 query 未来是否继续被包含进分析",并建议 FP 用户向 CodeQL 仓库贡献改进——反馈闭环存在但偏弱。同一数据流多路径归并为单条 alert;Test/Library 代码自动打标签;实验性 ML 告警已于 2023 年退役。(来源:https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts 、https://docs.github.com/en/code-security/code-scanning/managing-code-scanning-alerts/about-code-scanning-alerts)

**修复闭环**:Copilot Autofix 生成建议 + 一键 "Create PR with fix"(草稿 PR),另有 Autofix REST API;更强的 Copilot cloud agent 可被指派 alert(单条或 1–25 条批量,或 REST 设 assignee 为 copilot-swe-agent),agent 探索代码库→生成 fix→验证→开 PR,可评论迭代;按 AI credits 计费,官方承认 best-effort,无法验证或疑似 FP 时会在 PR 中说明。(来源:同上)

**MCP/Agent**:官方 GitHub MCP Server,远程(https://api.githubcopilot.com/mcp/)与本地 Docker/stdio 双形态;`code_security` toolset 含 get/list_code_scanning_alerts,`copilot` toolset 可 assign_copilot_to_issue、request_copilot_review。(来源:https://github.com/github/github-mcp-server)

**痛点信号**:ML alerts 退役(https://github.blog/changelog/2023-09-29-codeql-code-scanning-deprecates-ml-powered-alerts/);多扫描配置导致 stale alert 需手动清理;第三方 SARIF 属性不全;Copilot 会话成本计入 AI credits、fix 验证仅 best-effort。(来源:同上)

### 2. SonarQube / SonarCloud

**研判**:状态机 Open→Accept(接受延后修)/False positive/Confirm + 评论,支持 bulk change、改严重级、打标签;Accepted/FP 不计入质量报告。新推 `sonar-resolve` 代码注释裁决(限 C/C++/Obj-C,每次分析重评估并优先于历史状态);`//NOSONAR` 被官方点名不建议。无 AI 级单条 triage。(来源:https://docs.sonarsource.com/sonarqube-server/user-guide/issues/managing.md)

**修复闭环**:AI CodeFix 生成修复建议供下个 PR 应用(组织管理员启用);更新的 Remediation Agent 面向主分支 backlog 自动产出 fix 建议并按项目级开关调度;针对 AI 生成代码新增 "Sonar way for agentic AI" Quality Gate——官方承认为人写的 QG 不适配 agent 代码。(来源:https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/administering-your-projects/ai-features.md 、https://docs.sonarsource.com/sonarqube-cloud/standards/ai-code-assurance/overview.md)

**MCP/Agent**:官方 SonarQube MCP Server,工具覆盖 Analysis、Issues(可 search/review/update)、Quality Gate、Hotspots、Dependency risks 及订阅制 Vortex context(架构搜索/调用流);支持 Claude Code/Codex/Cursor/Copilot/Devin/Zed 等十余客户端,并驱动 GitHub agent apps。(来源:https://docs.sonarsource.com/sonarqube-mcp-server/about-the-mcp-server.md)

**演进方向**:全部投入 "Agent Centric Development Cycle"(Sonar Vortex、Hunter Agent 等新文档区);AI Code Assurance 靠标签+QG+徽章,未做单条报警级 AI 研判。(来源:https://docs.sonarsource.com/)

### 3. Semgrep(AppSec Platform)

**研判/降噪**:五家中最接近完整闭环。Multimodal Autotriage 将规则类 findings 自动标为 **Provisionally ignored**(疑似 FP),人工可推翻为 Ignored 或 To fix(AI-powered detection 类不自动降级);ignore 必须选原因(False positive/Acceptable risk/No time/Duplicate 等)+ 评论;PR/MR 评论 `/fp` `/ar` `/other` `/open` 即可 triage;跨分支 triage 自动传播;Policies 页可禁规则;有 bulk triage API。(来源:https://docs.semgrep.dev/semgrep-code/triage-remediation.md)

**修复闭环**:Autofix 由 AI 生成并**自动开 draft PR**(2–10 分钟),同文件同规则多条 finding 合一 PR;需启用 Multimodal(Amazon Bedrock/Claude)、消耗组织 AI credits;与规则内静态 rule-defined fix、Multimodal remediation advice 是三条并行线。(来源:https://docs.semgrep.dev/semgrep-code/triage-remediation/autofix.md)

**MCP/Agent**:Semgrep Guardian——官方 Semgrep MCP server + hooks,支持 Claude Code(插件)、Codex、Cursor、Copilot、Devin/Windsurf、Kiro 等,在 AI 生成代码落地前扫描;规则生态为公开 Registry + 私有规则。(来源:https://docs.semgrep.dev/llms.txt)

**痛点信号**:2026-09-28 周报显示 Autotriage 的阻断策略曾在首扫后失效(刚修复)、AI 功能开始要求权限收敛;Guardian 更新曾最长延迟一周(2.5.4 改为发布即拉取)。(来源:https://docs.semgrep.dev/release-notes/2026-09-28.md)

### 4. Snyk Code / DeepCode AI

**AI 优先级与抑制**:Priority Score / Risk Score(EA)结合 reachability、exploit 成熟度排序;Snyk Code 忽略不支持 `.snyk` 文件,依赖 IR 中间表示匹配使"变量重命名后同一问题"不再重复报;Consistent Ignores 让 ignore 在 Web/CLI/IDE/PR check 全端生效;Ignore Approval Workflow(EA)为风险接受加审批;Enterprise 可按 CWE/规则/severity 批量 ignore 的 Security policies;ignore 记录操作人、可强制填原因。**无单条报警级 AI FP 研判**——AI 用在评分和修复。(来源:https://docs.snyk.io/scan-fix-and-prevent/fix/prioritize-issues-for-fixing/ignore-issues.md 、https://snyk.io/platform/deepcode-ai/)

**修复闭环**:Snyk Agent Fix(原 DeepCode AI Fix,2026-05 重构为 agentic 架构):从 35,000+ 专家修复库动态 few-shot → 生成 k 个候选 → 静态引擎验证 → 失败 agentic retry;形态是 **IDE 内建议 + Apply fix 后重扫确认**,不是自动 PR;明示仅单文件修复、需人工 review,不达标不出建议。(来源:https://docs.snyk.io/scan-fix-and-prevent/scan-with-snyk/snyk-code/manage-code-vulnerabilities/fix-code-vulnerabilities-automatically.md)

**MCP/Agent**:Snyk MCP Server 仅本地 stdio(`npx snyk@latest mcp`),官方明确"不提供 hosted remote MCP";Snyk Studio 提供 hooks + Secure-at-inception/Remediation directives、Lite/Full/Experimental 工具档位。(来源:https://docs.snyk.io/agent-security/agentic-security-with-snyk-studio/getting-started-with-snyk-studio.md 、https://docs.snyk.io/developer-tools/ai-and-agent-access.md)

**痛点信号**:官方承认旧 fix 准确率不足而整体重构(https://snyk.io/blog/snyk-agent-fix-agentic-architecture/);Rust/Groovy 等语言 EA;Snyk Code 与 `.snyk` 文件不兼容需专门 FAQ。(来源:同上)

### 5. DeepSource

**研判/降噪**:无 AI triage。ignore 支持三级作用域(文件 glob/测试文件/全仓库);单条 occurrence 可 "Ignore and mark as false positive" 并**上报给 DeepSource 工程团队改进 analyzer**——反馈闭环靠厂商人工而非本地沉淀;代码内 `skipcq` 注释抑制;依赖漏洞用 Dynamic Risk Score(CVSS+EPSS+reachability)排序并展示调用链。(来源:https://docs.deepsource.com/docs/platform/dashboard/repository/issues 、https://docs.deepsource.com/docs/platform/getting-started/fix-issues)

**修复闭环**:Autofix 一键修复该 issue 全部 occurrence——默认分支触发则建 PR、PR 内触发则直接 commit;依赖漏洞修复带 AI Overview 与 breakage 风险分。仅覆盖支持 Autofix 的 issue。(来源:同上)

**MCP/Agent**:未见官方 MCP server(未能验证不存在);官方路径是 DeepSource CLI(`issues/metrics/runs/vulnerabilities --output json`)+ 官方 agents skill,面向 18+ 编码 agent。(来源:https://docs.deepsource.com/docs/platform/getting-started/cli-with-ai-agents)

**痛点信号**:changelog 抓取失败,未能验证;从文档看 Autofix 覆盖率有限、FP 处理依赖上报等待。

---

## 第二部分:AI 代码智能赛道(4 家)

### 1. Sourcegraph(Cody / Amp / Code Intelligence Platform)

**检索/上下文**:核心是"索引全部仓库的上下文层"。Code Search 提供正则/关键词/符号/diff 搜索,宣称跨分支提交"无需索引"(https://sourcegraph.com/docs/code_search);跨仓库 go-to-definition/find-references 由 SCIP 开放标准的精确代码索引驱动(https://sourcegraph.com/mcp)。检索 API 以 MCP 工具交付:语义+关键词+正则搜索、read_file、定义/引用、diff、Deep Search(带 citations 的自然语言答案)、ownership;Code Finder(GA)内置检索 agent,一次调用返回"文件路径+行范围+说明",官方基准显示比 agent 自搜更快更省(https://sourcegraph.com/changelog/code-finder-ga)。Cody 经 Search API 从本地+远端仓库拉上下文(https://sourcegraph.com/docs/cody/overview)。SCIP 专题站抓取失败,细节未能验证。

**Agent 集成**:MCP server 明确兼容 Claude Code/Codex/Cursor/Amp(https://sourcegraph.com/mcp);自有 agent 双线:Amp(云 VM "Orbs"+CLI,Librarian 子代理可搜 GitHub 公私库,https://ampcode.com/docs)与 Cody IDE 助手、Agentic Batch Changes(大规模变更 frontier agent,https://sourcegraph.com/changelog/agentic-batch-changes-ga)。

**文档沉淀**:首页列有 "Living Documentation" 愿景,未见独立产品页,落地形态未能验证(https://sourcegraph.com/)。无 DeepWiki 类生成器。

**痛点信号**:卖点即痛点——首页反复演示 "agent 只见局部、漏改 7 层"(https://sourcegraph.com/);changelog 在补上下文过滤/排除清单、代码托管接入向导、签名提交导致 PR 无法合并等(https://sourcegraph.com/changelog/2026-10-05)。商业模式重:$16K 起年度合同 + AI credits(https://sourcegraph.com/pricing);支持单租户云与 self-hosted。

### 2. Greptile

**检索/上下文**:入库时解析全部文件,抽取文件/函数/类/变量,建立"调用、import、依赖、变量使用"图谱并存储;review 时查图谱做依赖、调用方(影响面)与模式一致性分析(https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context.md)。评论带文件路径+行号+建议修复,PR 有 0-5 置信分(https://www.greptile.com/docs/introduction)。对外 API:官网 FAQ 称可用 API 构建自家产品(https://www.greptile.com);旧 REST 文档站 docs.greptile.com 两次连接失败,具体端点未能验证。

**Agent 集成**:MCP server v2 提供拉取评论、自动修复、读知识库、管理规则等工具,支持 Cursor/Claude Code/VS Code/Codex CLI OAuth 接入;"Fix with your Agent" 一键把问题(含路径/行号/建议代码)发给 Claude Code/Codex/Conductor/Cursor/Devin,/greploop 让任意 agent 迭代修复(https://www.greptile.com/docs/mcp-v2/overview.md、/docs/changelog.md)。

**知识沉淀**:Knowledge Base——"持续生长的代码库知识库(架构/流程/约定)用于增强 review" + 从 PR 评论学习团队标准(https://www.greptile.com/docs/how-greptile-works/knowledge-bases.md),面向 agent 消费,非人读 wiki。

**痛点信号**:防噪音是主线——Brex 证言"唯一不烦人的 AI reviewer";控 Nitpickiness/严重度阈值/Review Tiers 分档计费(https://www.greptile.com/docs/how-greptile-works/nitpicks.md);v4 用 LLM-as-judge 把"被采纳评论/PR"从 0.92 提到 1.60(changelog);TREX 自动测试 PR、定位"独立验证者"回应 agent 量产代码;企业补 Docker/K8s/air-gapped 自托管与自带 LLM(https://www.greptile.com/docs/deployment-options.md)。

### 3. DeepWiki(Cognition)+ deepwiki-open(开源复刻)

**能力**:DeepWiki 为 Devin Wiki/Search 的公开免费版:自动生成"架构图+文档+源码链接",github.com 换 deepwiki.com 即达,已预索引 5 万+ 公共仓库;私有库需 Devin(https://cognition.ai/blog/deepwiki)。问答走 Ask Devin grounded 回答。`.devin/wiki.json` 可显式控制页面结构(层级、repo_notes);生成按算力分档:Low 免费 / Medium 约 5-10 ACU / High 约 20-40 ACU,企业锁定 Low(https://docs.devin.ai/work-with-devin/deepwiki.md)。索引技术细节官方未公开,未能验证;主站直接抓取失败,页面形态未能验证。

**MCP**:官方 DeepWiki MCP https://mcp.deepwiki.com/,免鉴权、公开仓库、三工具 read_wiki_structure / read_wiki_contents / ask_question,Streamable HTTP;私有库走 Devin MCP(https://docs.devin.ai/work-with-devin/deepwiki-mcp.md)。

**痛点信号**:官方 troubleshooting 自认"大仓库漏目录是经典问题",需手工 wiki.json 补页;生成成本按 ACU 计费(同上)。开源复刻 deepwiki-open:MIT、自托管、18.2k star,结构分析→文档→Mermaid 图→wiki→codemap,支持 Ollama 本地模型;2.0 转向桌面发行,215 个 open issues 显示维护压力大(https://github.com/AsyncFuncAI/deepwiki-open)。

### 4. Cursor

**检索/上下文**:搜索栈已转向本地 Instant Grep(2.1,2025-11)——自研搜索引擎,"在本机构建与查询索引,不上传路径/代码,也不为搜索存储 embeddings"(https://cursor.com/changelog/2-1;原 codebase-indexing 文档现跳转 Search)。Agent 有 Explore 子代理并行搜索、只回传结论以省上下文。无独立检索 API,上下文经由 IDE/agent 内部工具提供。

**Agent 集成**:MCP 一等公民:stdio/SSE/Streamable HTTP,支持 Tools/Prompts/Resources/Roots/Elicitation、OAuth、企业 allowlist(https://cursor.com/docs/mcp);Cloud Agents 在隔离 VM 运行,支持 MCP、API/Slack/GitHub/Linear 触发、多仓库协作、hooks、按模型计费(https://cursor.com/docs/cloud-agents)。

**知识沉淀**:无仓库→结构化 wiki 能力(未能验证任何此类功能);沉淀为 Rules/计划文档/AGENTS.md 式规则(https://cursor.com/changelog/2-1)。

**痛点信号**:编辑器内 AI Code Review 与 Bugbot 并行补审查、Plan Mode 追问式澄清、移除 custom modes(破坏性变更)、企业 allowlist、云 agent 补 GitLab/GHE/Sentry 集成(同上)。

---

## 第三部分:横向综合(决策输入)

### SAST 研判赛道的共同形态与短板

1. **triage 语义高度趋同**:五家的裁决都是"状态机 + 原因枚举 + 评论 + 批量操作"(FP/Accept/Ignore+reason)——RepoGraph 的 `SUSPECTED→CONFIRMED→FIXED/DISMISSED` 状态机与 ReviewQueue 状态机与此对齐,无范式风险。
2. **AI 研判两派,无人让 AI 直接关报警**:Sonar/Semgrep 让 AI 预判 FP 但强制人工确认(Provisionally ignored / Accepted 前置);GitHub/Snyk 的 AI 主攻修复侧。→ **RepoGraph"启发式研判 + advisory-only LLM 复核 + 人工审核终审"的边界设计与行业共识一致,不需要推翻**。
3. **反馈闭环普遍浅**:人工 dismiss/ignore 基本只沉淀为记录;规则级沉淀仅 Semgrep(Policies)、Snyk(policies 批量 ignore)、DeepSource(上报厂商)局部存在;**无人做版本化反馈 + 变体自动召回**——RepoGraph 的 `TriageFeedbackStore`(指纹+双版本校验)和 `VulnerabilityVariantService` 是真实差异化,但缺少 T11-2 效果评估来证明价值。
4. **MCP 全面铺开,竞争焦点前移**:GitHub(远程+本地)、Sonar(可编程 update issue)、Semgrep(Guardian 编码前拦截)、Snyk(本地 stdio)、DeepSource(CLI+skill)全有 agent 入口;2026 焦点已从"事后 triage"前移到"编码时 hooks/directives 拦截"。→ RepoGraph MCP 23 工具方向正确,但缺少 Semgrep Guardian 式的"编码前"叙事。
5. **修复形态分层,全保留人工关卡**:自动 PR(GitHub agent/Semgrep/DeepSource)> 建议+应用(Sonar/Snyk IDE)> 人工;多文件修复受限(Snyk 明示单文件)、fix 验证 best-effort 依赖重扫。→ RepoGraph 的 P3 修复闭环若启动,应瞄准"多文件、图谱证据驱动、重扫验证"的缺口。
6. **生态位空缺(最大发现)**:五家都是"内置扫描器 + SaaS 平台"垂直栈,**"多引擎报警导入 + 独立研判层"这一生态位五家均不开放**;最接近的接缝是 Sonar MCP 可编程更新 issue 状态。→ RepoGraph P0 主线的定位在这个样本里成立;⚠️ 但样本全部是 SaaS 大厂,需要 TRIAL-PROTOCOL 的真实团队反馈来验证"企业愿意为此单独部署研判层"的商业假设。

### AI 智能层赛道的共同形态与短板

1. **索引形态四派,无一家做双向量 GraphRAG**:Sourcegraph=精确符号图(SCIP)+文本搜索;Greptile=函数/依赖图谱+从 PR 评论学习;Cursor=本地即时 grep(放弃 embedding 存储);DeepWiki=不做可查询索引、一次性 LLM 生成。→ RepoGraph 的差异化成立,但 Cursor 放弃 embedding 转本地 grep 是一个值得记录的反向信号。
2. **分层摘要:需求被 DeepWiki 大规模验证,增量维护是共同空白**:DeepWiki 5 万+仓库证明"仓库→分层结构化摘要"有真实需求,但输出是一次性快照、官方自认大仓库漏目录;Greptile Knowledge Base 是"摘要服务 agent"的已验证变体;Sourcegraph Living Documentation 只是愿景。→ **DeepMap 借鉴设计(增量、citation-ready、agent+人双消费)正落在四家共同空白上,方向被外部证据支持**。
3. **上下文成本成为计价单位**:Sourcegraph credits、DeepWiki ACU、Greptile Review Tiers、Cursor 按 token——精准供给优于堆料是共识。→ RepoGraph Context Pack 的字符预算机制与此同向。
4. **行级溯源是标配**:Code Finder(文件+行范围)、Greptile(路径+行号+建议)、DeepWiki(source links)、Deep Search(citations)。→ RepoGraph SourceCitation 纪律与行业一致,无超前风险。
5. **外部编码 agent 成分发渠道**:"Fix with your Agent"、DeepWiki MCP 免鉴权公开、Greptile MCP v2——知识/校验产品把 Claude Code/Codex/Cursor 当下游。
6. **本地优先几乎是空位**:四家均云为中心,仅 Greptile(air-gapped 自托管)与 deepwiki-open(Ollama 本地)提供内网选项;"单机 + 代码不出内网 + 完整离线知识图谱"未被头部厂商占据,但 Greptile/Devin 都在补私有化——窗口期存在但不是永远。

### 值得带入下一步决策的三个问题(供 discovery / decision-forge 使用)

1. "多引擎报警独立研判层"的付费意愿:五家大厂都不开放的生态位,是没人能做,还是没人需要?→ 合并 TRIAL-PROTOCOL 外联验证。
2. 分层摘要(Wiki)作为仓库智能层的第一入口:DeepWiki 已教育市场,RepoGraph 以"增量维护 + 图谱事实直供 + 双消费"切入——DeepMap S1 的优先级是否应高于 T11-2 之外的其它项?
3. 研判层的 MCP 竞争焦点已前移到"编码前拦截"(Guardian 模式):RepoGraph 是否需要在 roadmap 中补一个"IDE 内 hooks"的远期位置,还是坚持事后研判闭环?

## 未能验证清单

- SonarQube MCP "SSAL 协议" 细节与 Vortex 订阅制范围(抓取受限)
- Greptile REST API 具体端点(docs.greptile.com 连接失败)
- DeepWiki 索引技术细节(官方未公开)与主站页面形态(抓取失败)
- Cursor 旧 embeddings 索引现状(文档已跳转)
- DeepSource changelog(访问失败)
- Sourcegraph Living Documentation 落地形态(仅愿景页)

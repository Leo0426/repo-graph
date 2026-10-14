# DeepMap 设计借鉴与分层摘要设计(2026-10-12)

> 状态:设计稿,未实现。来源项目:`D:\Projects\token_infinity\platform\inf-deepmap`(AI 驱动的代码仓库文档生成系统,DeepWiki 类产品)。
> 本文不修改任何领域事实;领域模型、metadata key 和架构决策的权威仍是 [CONTEXT.md](../../CONTEXT.md)。
> 文中"DeepMap 引用"均指来源项目内文件路径与行号,供实现时对照。

## 1. 背景与目标

- RepoGraph 的补充定位是"编码 Agent 的代码仓库智能层";README"待开发"明确列有**分层摘要**。
- DeepMap 已验证的产品闭环:仓库接入 → 4 阶段生成流水线(代码向量库 → 架构文档 → 逐文件子文档 → Wiki 向量库)→ 文档树浏览/RAG 对话/导出 → MCP 对外暴露。
- 本文目标:(a) 判断 DeepMap 各块设计对 RepoGraph 的适配性;(b) 给出**分层摘要/Wiki 生成**的详细设计(领域放置、流水线、增量、REST/MCP/UI、切片)。

**借鉴原则**:借设计不借实现。不引入 Python/Docker/FAISS/MySQL 栈;所有 LLM 生成遵守 RepoGraph 既有约束——本地优先、citation 只保留输入事实中存在的引用、降级显式标记不伪装为完整结论、模型输出不改启发式事实。

## 2. DeepMap 整体设计借鉴分析

### 2.1 架构速览

DeepMap 三层架构:Python Agent(Docker 容器内执行,一任务一容器)+ FastAPI Backend(任务/状态/产物管理)+ Next.js Frontend(文档树浏览与对话)。产物目录 `wiki/<group>/<platform>/<owner>/<repo>/<branch>/<commit8>/arch/vN/*.md` 与 `subdoc/vN/**`(镜像源码树),每组产物附 `.metadata.json`,版本目录倒序支持历史视图(DeepMap 引用:`agent/README.md`、`backend/app/routers/wiki.py:111-155`)。

### 2.2 借鉴判断清单

| DeepMap 设计 | 核心机制 | RepoGraph 判断 |
|---|---|---|
| 分层文档生成(架构文档 + 子文档) | Agentic 探索:agent 挂 Retriever/File/Bash/AST 工具逐页生成;章节规划→标题拆分→逐节内容;缓存按 `task_id/run_id` 落盘断点续跑 | **采纳并改造**(见 §3)。差异:RepoGraph 以图谱事实替代 agent 探索,更省 token、可复现 |
| 子文档两步生成 | CheckSubDocAgent 先判断"是否值得写"(无效结果 fail-open),再生成正文;强制溯源行号链接;`regen_mode=missing` 合并历史版本只补缺失 | **采纳思路**。判断步骤改造为图谱信号(入口点数、调用边数、CC>10 方法数)决定包摘要优先级 |
| 流水线编排 | 4 阶段子进程;`skip_phases` 幂等跳过已完成阶段;仅 embedding 失败中止全流程,arch/subdoc 互不阻断;阶段间暂停门控轮询 | **采纳失败隔离与续跑语义**,对齐索引管道既有顺序恢复机制;暂停门控暂不需要(单用户本地场景) |
| 一任务一容器隔离 | 常驻容器沙箱,`docker exec` 注入脚本,容器名规范化,资源可计费 | **暂存备用**。对应 T7 隔离容器动态验证(被试用门禁阻塞);届时参考 `backend/app/container_manager.py` 与 `docs/task-container-limits.md` |
| 统一来源抽象(Git + Upload 归一 Repo) | `source_type` 区分但共用 Task/状态机/Webhook;branch/commit 版本化;增量调度器扫描本地 commit 对比远端 | **对应已知差距**:roadmap 明确记录"不支持未检出的远程仓库多仓检索"。建议在 P2 或试用后单独立项,不并入本文范围 |
| Wiki RAG 对话(先文档后代码) | agent 同时挂 wiki/代码两个检索器,prompt 约束先用文档;引用分三类(架构/子文档/源码行号) | **暂缓**。RepoGraph 的 Context Pack 已是 citation-ready 证据包;对话入口等分层摘要落地后再评估 |
| MCP agentic transformation | L1-L4 路线:读写双向 → 实时上下文(调用图/依赖)→ 自主编排;五原则:结构化数据非 Markdown、精确查询非全文、发现→定位→深入链路 | **采纳为 MCP 演进参考**。与现有 23 个 stdio 工具的形态一致,新增摘要工具时遵循 |
| 多租户 group 隔离、用量统计、Webhook | `primary_group` 边界;DAU/token 用量看板;webhook 订阅与投递记录 | **P4 企业化参考**。DeepMap PRD(`docs/deepmap-prd-draft.md`)可作为 P4 启动时的对标文档 |
| 滑动窗口代码分块 | 500 字符/overlap 50/单文件 100 块,无函数边界感知 | **不采纳**。RepoGraph 按 CodeUnit(类/方法)结构化分块,粒度优于行窗口;DeepMap 行窗口是因为缺少 AST |
| FAISS 双向量库 | 代码 chunk 库 + wiki 标题切块库,413 递归切分兜底 | **不采纳实现,采纳双向量思路**。RepoGraph 已有 Qdrant 双向量(semantic/code);文档单元直接复用现有管道 |

### 2.3 明确不引入

- **多租户/OAuth/用量计费**:违背当前本地优先、单用户阶段;留 P4。
- **MySQL / Next.js BFF**:技术栈不符;存储用 SQLite,前端用现有 Thymeleaf + HTMX。
- **LLM 自动编辑 Wiki 文件的交互**(chat 中允许改文档不改源码):超出当前范围,摘要版本由流水线管理。

## 3. 分层摘要/Wiki 生成设计

### 3.1 目标与非目标

**目标**:为已索引(`READY`)项目生成两层 LLM 摘要——**项目级架构摘要**与**包级子摘要**——入库为文档单元参与语义检索与 GraphRAG/Context Pack,并在 Web 提供文档树浏览。让编码 Agent 通过 `search_semantic`/`build_context_pack` 直接命中"这个项目如何组织"级别的答案,而不必现场探索。

**非目标**:不做 Wiki 对话(§2.2 暂缓);不做多租户;不修改源码;不替代 `MarkdownDocParser` 对用户手写文档的索引;不把摘要写入 VulnStore 或影响研判结论。

### 3.2 与 DeepMap 的关键设计差异(决策依据)

| 决策点 | DeepMap 方案 | RepoGraph 方案 | 理由 |
|---|---|---|---|
| 输入来源 | Agent 挂工具自主探索(向量检索+读文件+AST) | **图谱事实直供**:包结构、入口点、CALLS 聚合、健康指标、危险 Sink 分布,LLM 只做归纳写作 | 省去多轮工具调用 token;输出可复现;符合 A/02"模型输入来自事实源"边界;RepoGraph 图谱是 DeepMap 没有的资产 |
| 子文档粒度 | 按文件,一文件一 md | **按包**。逐文件摘要性价比低——符号级细节已可按需从图/向量精确获取 | 图谱已覆盖文件内结构;包摘要补的是"模块职责"层 |
| 文档存储 | 独立 wiki 目录 + FAISS wiki 库 | **复用 DOCUMENT CodeUnit + Qdrant 双向量**,走现有索引管道写入 | 不新增存储栈;`MarkdownDocParser` 已把 md 按标题切为 DOCUMENT 单元 |
| 版本与缓存 | `task_id/run_id` JSON 缓存 + `vN` 目录 | 按 `projectId + codeVersion` 指纹缓存生成阶段;产物版本 `doc_version` 递增,旧版本保留可回看 | 与 TriageReport 的 `codeVersion` 版本化纪律一致 |
| 引用格式 | GitHub blob 链接 + `#L15-L25` | `SourceCitation`(qualifiedName + filePath + start/endLine),与 Context Pack 编号规则一致 | 私有仓库无 blob 可链;citation 必须能回指图内符号 |

### 3.3 领域放置与模型(遵循 [Architecture](../ARCHITECTURE.md) 放置规则)

- **core**(`com.repograph.core.wiki`):`SummaryDocument`(级别 `PROJECT | PACKAGE`,title、sections、citations、`codeVersion`、`docVersion`、`generatedAt`、status)、`SummaryScope`、`SummaryJobSpec` 与 `SummaryGenerationService` 接口;只依赖 JDK 和 core。
- **实现**(`com.repograph.wiki`):事实收集器(消费 `GraphQueryService`/`GraphDiagnosticsService`/`HealthReportService`,不复制指标事实源)、LLM 摘要模型适配(复用 advisory 的 Ollama 设置读取方式)、SQLite `SummaryStore`、流水线编排。
- **任务台账**:生成任务复用 `com.repograph.agent` 的 AgentRun/AgentStep 记录执行状态与步骤引用,不另建平行台账,也不在 AgentRun 中复制摘要事实(符合"AgentRun 只编排和可观测"边界)。
- **LLM 通道**:复用 Agent 页面保存的 Ollama 开关/BaseURL/模型/超时(同 A/02 做法);默认关闭;使用独立 executor,不占用 `llmAdvisoryExecutor` 和 `architectureReviewExecutor`。
- **存储映射约束**:摘要以 Markdown 文件落盘 `${user.home}/.repograph/assets|projects` 内约定子目录,经 `MarkdownDocParser` → DOCUMENT CodeUnit 入图与向量。**不新增 CodeUnitKind**(避免 Qdrant payload/SQLite/Neo4j 三处映射变更);metadata 新增 `is_generated="true"` 与 `doc_version`,实现时须同步 CONTEXT.md 标准 key 表。

### 3.4 生成流水线(阶段化,失败隔离)

```
Phase 0  前置检查:项目 READY、Ollama 启用(未启用则只产出 Phase 1 产物)
Phase 1  结构事实收集(无 LLM):包/模块清单、入口点、跨包 CALLS 聚合、
         圈复杂度热点、危险 Sink 与敏感配置分布、README/DOCUMENT 章节索引
         → 产物"结构卡"(确定性,无模型也能用,等价 DeepMap 保底页但数据更准)
Phase 2  架构摘要(LLM):输入 = 结构卡 + 关键符号签名(带预算裁剪与脱敏)
         章节:项目概述 / 模块划分 / 入口与调用链 / 构建与运行 / 安全相关面
         单章节失败跳过,不阻断其他章节
Phase 3  包级子摘要(LLM):按包生成职责、对外接口、内部流程、风险信号;
         生成优先级按图谱信号排序(入口点数、CALLS 入度、CC 热点);
         单包失败跳过并记 omittedReasons
Phase 4  入库:Markdown → MarkdownDocParser → 图/向量写入(复用现有管道,
         filePath 约定 .repograph/wiki/arch/vN/** 与 .repograph/wiki/pkg/vN/**)
         → embedding 双向量(semantic=章节文本,code=章节文本,同 DOCUMENT 规则)
Phase 5  版本提交:全部成功章节落 doc_version=N+1 并写 SummaryStore;
         阶段缓存按 (projectId, codeVersion, phase, scopeId) 落 SQLite,重启续跑跳过已完成项
```

失败语义对齐 DeepMap 并适配本管道:Phase 1 失败中止(后续依赖它);Phase 2/3 互不阻断、单章节/单包失败局部跳过;Phase 4 失败保留缓存待重试(与索引管道 partial 语义一致);全败时仍交付 Phase 1 结构卡,页面显式标注"LLM 摘要未启用/失败",不伪装为完整摘要。

### 3.5 增量更新

- 触发:复用文件监听与索引增量结果;变更文件所属包标记摘要 dirty。
- 行为:仅重生成 dirty 包的子摘要;架构摘要末尾追加"增量变更说明"章节(DeepMap 增量模式),列出变更包与新入口点;`doc_version` 递增,旧版本目录保留可回看。
- 更新期间旧摘要保持可检索(先写新版本再切换),不中断检索与问答。
- 边界:不做 DeepMap 式远端 commit 轮询;本地增量以索引管道的文件监听为准。

### 3.6 REST / MCP / Web

- REST:`POST /api/v1/summaries/generate?projectId=...`(202,复用 agent executor 队列与拒绝语义)、`GET /api/v1/summaries?projectId=`、`GET /api/v1/summaries/tree`(文档树,DeepMap FileNode 简化版:name/path/level/docVersion/keywords)、`GET /api/v1/summaries/{id}`。
- MCP:新增 `get_project_summary` 与 `search_wiki`(遵循"MCP 新工具复用 app 领域能力,不在传输层复制逻辑")。
- Web:现有工作台内新增"项目文档"页(文档树 + 章节浏览 + citation 跳转),不新开一级导航;生成进度走既有轮询模式。

### 3.7 安全与边界(继承既有约束)

- LLM 输入:剔除源码 raw 中的秘密(复用 advisory 脱敏),字符预算裁剪,证据标记 untrusted。
- 输出:只保留输入 ContextPack/事实中存在的 citation,不存在的引用进 `missingInfo`;中文可读性要求同 A/02;SLF4J 审计只记请求 ID、指纹、模型、状态、延迟、脱敏次数,不记提示词与源码。
- 摘要是派生事实:不得创建、升级或降级 VulnFinding/TriageReport;研判流水线不消费摘要结论。

### 3.8 切片拆分与验证

| 切片 | 内容 | 验证入口 |
|---|---|---|
| S1 | Phase 1 结构卡 + 包级确定性摘要 + SummaryStore + REST 最小闭环(无 LLM) | `./gradlew test` 新增 `com.repograph.wiki` 域测试;真实项目索引后冒烟 |
| S2 | LLM 架构摘要 + 阶段缓存/续跑 + Web 文档树页 | 域测试 + Ollama 开/关两态降级验证 |
| S3 | 增量更新(包级 dirty)+ 版本树 + MCP 工具 | 域测试 + `:repograph-mcp:test` + 修改文件后增量冒烟 |

每片完成后按 [VALIDATION](../VALIDATION.md) 报告实际执行结果;`BUILD SUCCESSFUL` 不证明集成通过。

## 4. 与路线图的关系

- 本设计对应 roadmap"补充定位"(编码 Agent 的仓库智能层),与 SAST 研判主线共享基建、不占用研判资源。
- 排期建议:**不改变现有优先级**——试用决策门(TRIAL-PROTOCOL 外联)与 T11-2 规则效果评估仍在前;本设计作为试用等待期/并行 B 线,或试用验证"安全团队付费"之外的第二增长曲线立项依据。
- 实现前按 [issue-tracker](../agents/issue-tracker.md) 建工单并领取;S2 涉及 metadata key 新增,须同步 CONTEXT.md 标准 key 表。

## 附录:DeepMap 关键机制索引(实现时对照)

| 机制 | DeepMap 引用 |
|---|---|
| 架构文档三阶段 agent(规划→标题→内容)与保底页 | `agent/generate_structure_doc.py:35,144-191,332-433,574-635,759-780` |
| 按 run_id 的断点缓存 | `agent/generate_structure_doc.py:326-330,575-576,859-862` |
| 子文档两步生成(check fail-open / 正文)与版本合并 | `agent/generate_sub_docs.py:307-325,359-414,416-495,568-583` |
| 强制溯源行号链接 | `agent/agents/sub_doc_agents/generate_sub_doc_content_agent.py:134-136` |
| 滑动窗口分块 | `agent/code_chunker.py:44-46,100-138` |
| 流水线编排/skip_phases/失败隔离/暂停门控 | `agent/run_pipeline.py:9-17,100-177` |
| Wiki RAG"先文档后代码"与三类引用 | `agent/agents/wiki_chat_agents/chat_agent.py:64-105` |
| 增量变更分析与版本目录 | `backend/app/services/incremental_update_service.py:37-135,208-317` |
| 文档树 FileNode 与版本视图 | `backend/app/models.py:383-408`、`backend/app/routers/wiki.py:111-155` |
| MCP agentic L1-L4 路线 | `docs/mcp-agentic-transformation.md` |
| 多租户与产品边界 | `docs/deepmap-prd-draft.md` |

# DeepMap 设计借鉴与分层摘要设计(2026-10-12)

> 状态:**S1/S2 已实现**(2026-10 提交 3820e45、8b047c4、d40c3ab,行为见 [CONTEXT.md](../../CONTEXT.md) wiki 一节);
> **S3 待做**(见 `.scratch/deepmap-wiki-summaries/issues/03-incremental-and-mcp.md`)。
> 来源项目:`D:\Projects\token_infinity\platform\inf-deepmap`(DeepWiki 类产品)。
> 领域权威仍是 [CONTEXT.md](../../CONTEXT.md);"DeepMap 引用"指来源项目内文件路径与行号,供实现时对照。
> 2026-10-16 压缩:§2 DeepMap 借鉴分析(其结论已体现在已实现的 S1/S2 中)与 §4 排期讨论已删除;
> 保留 S3 实现所需的全部设计约束。

## 3. 分层摘要/Wiki 生成设计

### 3.1 目标与非目标

**目标**:为已索引(`READY`)项目生成两层 LLM 摘要——**项目级架构摘要**与**包级子摘要**——入库为文档单元
参与语义检索与 GraphRAG/Context Pack,并在 Web 提供文档树浏览。

**非目标**:不做 Wiki 对话;不做多租户;不修改源码;不替代 `MarkdownDocParser` 对手写文档的索引;
不把摘要写入 VulnStore 或影响研判结论。

### 3.2 领域放置与模型(遵循 [Architecture](../ARCHITECTURE.md) 放置规则)

- **core**(`com.repograph.core.wiki`):`SummaryDocument`(级别 `PROJECT | PACKAGE`,title、sections、
  citations、`codeVersion`、`docVersion`、`generatedAt`、status)、`SummaryScope`、`SummaryJobSpec` 与
  `SummaryGenerationService` 接口;只依赖 JDK 和 core。
- **实现**(`com.repograph.wiki`):事实收集器(消费 `GraphQueryService`/`GraphDiagnosticsService`/
  `HealthReportService`,不复制指标事实源)、LLM 摘要模型适配(复用 advisory 的 Ollama 设置读取方式)、
  SQLite `SummaryStore`、流水线编排。
- **任务台账**:复用 `com.repograph.agent` 的 AgentRun/AgentStep 记录执行状态,不另建平行台账。
- **LLM 通道**:复用 Agent 页面保存的 Ollama 开关/BaseURL/模型/超时;默认关闭;独立 executor。
- **存储映射约束**:摘要以 Markdown 文件落盘 `${user.home}/.repograph` 约定子目录,经 `MarkdownDocParser`
  → DOCUMENT CodeUnit 入图与向量。**不新增 CodeUnitKind**;metadata 新增 `is_generated="true"` 与
  `doc_version`,实现时须同步 CONTEXT.md 标准 key 表(S3 范围)。

### 3.3 与 DeepMap 的关键设计差异(决策依据)

输入来源用**图谱事实直供**(替代 agent 探索);子文档粒度**按包**(替代按文件);存储**复用
DOCUMENT CodeUnit + Qdrant 双向量**(不新增存储栈);版本与缓存按 `projectId + codeVersion` 指纹;
引用格式统一 `SourceCitation`(qualifiedName + filePath + start/endLine)。

### 3.4 生成流水线(阶段化,失败隔离)

```
Phase 0  前置检查:项目 READY、Ollama 启用(未启用则只产出 Phase 1 产物)
Phase 1  结构事实收集(无 LLM):包/模块清单、入口点、跨包 CALLS 聚合、
         圈复杂度热点、危险 Sink 与敏感配置分布、README/DOCUMENT 章节索引
         → 产物"结构卡"(确定性,无模型也能用)
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

失败语义:Phase 1 失败中止(后续依赖它);Phase 2/3 互不阻断、单章节/单包失败局部跳过;
Phase 4 失败保留缓存待重试(与索引管道 partial 语义一致);全败时仍交付 Phase 1 结构卡,
页面显式标注"LLM 摘要未启用/失败",不伪装为完整摘要。

### 3.5 增量更新

- 触发:复用文件监听与索引增量结果;变更文件所属包标记摘要 dirty。
- 行为:仅重生成 dirty 包的子摘要;架构摘要末尾追加"增量变更说明"章节,列出变更包与新入口点;
  `doc_version` 递增,旧版本目录保留可回看。
- 更新期间旧摘要保持可检索(先写新版本再切换),不中断检索与问答。
- 边界:不做 DeepMap 式远端 commit 轮询;本地增量以索引管道的文件监听为准。

### 3.6 REST / MCP / Web

- REST:`POST /api/v1/summaries/generate?projectId=...`(202,复用 agent executor 队列与拒绝语义)、
  `GET /api/v1/summaries?projectId=`、`GET /api/v1/summaries/tree`(文档树:name/path/level/docVersion/keywords)、
  `GET /api/v1/summaries/{id}`。
- MCP:新增 `get_project_summary` 与 `search_wiki`(复用 app 领域能力,不在传输层复制逻辑)。
- Web:现有工作台内新增"项目文档"页(文档树 + 章节浏览 + citation 跳转),不新开一级导航。

### 3.7 安全与边界(继承既有约束)

LLM 输入剔除源码 raw 中的秘密(复用 advisory 脱敏)、字符预算裁剪、证据标记 untrusted;
输出只保留输入事实中存在的 citation,不存在的引用进 `missingInfo`;SLF4J 审计不记提示词与源码;
摘要是派生事实,不得创建、升级或降级 VulnFinding/TriageReport。

### 3.8 切片拆分与验证

| 切片 | 内容 | 状态 |
|---|---|---|
| S1 | Phase 1 结构卡 + 包级确定性摘要 + SummaryStore + REST 最小闭环(无 LLM) | ✅ 完成(3820e45) |
| S2 | LLM 架构摘要 + 阶段缓存/续跑 + Web 文档树页 | ✅ 完成(8b047c4、d40c3ab) |
| S3 | 增量更新(包级 dirty)+ 版本树 + MCP 工具 | ⬜ 待做;验证:`./gradlew test` 域测试 + `:repograph-mcp:test` + 修改文件后增量冒烟 |

## 附录:DeepMap 关键机制索引(S3 实现时对照)

| 机制 | DeepMap 引用 |
|---|---|
| 按 run_id 的断点缓存 | `agent/generate_structure_doc.py:326-330,575-576,859-862` |
| 增量变更分析与版本目录 | `backend/app/services/incremental_update_service.py:37-135,208-317` |
| 文档树 FileNode 与版本视图 | `backend/app/models.py:383-408`、`backend/app/routers/wiki.py:111-155` |
| MCP agentic L1-L4 路线(结构化数据非 Markdown、精确查询非全文) | `docs/mcp-agentic-transformation.md` |

# RepoGraph TypeScript 重写基线

本文件记录 Java 版最后一版已实现的产品行为和重写验收标准。依据为旧 `main` 的 `3a332ef`，核对了 REST 控制器、MCP 工具目录、领域模型、测试与功能验收文档。以下能力是 TypeScript 重写的参考目标，当前交付状态以 TypeScript 代码及实际验证结果为准。从本仓库开始工作时先读本文；新增领域字段或改变已确认契约时同步更新本文。

## 产品目标与范围

RepoGraph 为开发者、编码 Agent 和研发安全团队提供基于仓库的代码理解、静态分析与人工研判。使用者可以接入仓库，检索符号和代码，用图谱、源码行号与引用核查结论，并对外部报警或变更进行有记录的人工审核。Web 与 REST 由应用提供，MCP 是独立 stdio 进程，经 HTTP 复用应用能力和权限。stdout 专用于 JSON-RPC，诊断走 stderr 或日志。

重写按可独立验证的主流程推进。先贯通项目接入、增量索引、关键词检索与源码定位，再扩展图谱、语义检索、资产与组织管理、静态分析、研判及审查。首个端到端验收用两个含同名符号的仓库，验证接入后可以从 REST 和 MCP 查到各自的证据，重启后仍可查询，增量更新和删除可核对。Web 界面、旧数据迁移和全部旧功能的对齐需要各自的验收证据。

## 领域契约与存储

- `projectId` 为规范化绝对项目根路径的 UTF-8 SHA-256 前 12 个十六进制字符。项目归属转移保留 ID。路径按项目根相对表示，以 `/` 分隔；源码行号从 1 开始。
- `CodeUnit` 包含 `id, kind, language, qualifiedName, simpleName, filePath, startLine, endLine, rawSource, signature, annotations, parentQualifiedName, metadata`。ID 为 `SHA256(projectId + filePath + kind + qualifiedName)` 的小写十六进制。空注解和 metadata 用空容器，顶层符号的 parent 为 null。Java 方法使用 `Type#method(params)`，嵌套类型使用 `Outer$Inner`。
- `CodeUnitKind` 为 `CLASS / INTERFACE / ENUM / ANNOTATION / METHOD / CONSTRUCTOR / FIELD / LOCAL_VAR / STRUCT / UNION / TYPEDEF / MACRO / FUNCTION / DOCUMENT`。Markdown 按 H1–H3 切为 DOCUMENT，`qualifiedName` 使用 `filePath#heading`，重名追加行号，语言为 `doc`。
- `RelationEdge` 包含 `sourceId, targetId, kind, resolved, filePath, sourceLine`。关系类型为 `CONTAINS / CALLS / IMPORTS / EXTENDS / IMPLEMENTS / DEFINES_TYPE / OVERRIDES`。继承与接口实现分别存储。调用目标有歧义时保留未解析状态，只持久化确定的 CALLS。
- 旧版 Neo4j 保存 CodeUnit、关系与项目范围，Qdrant 保存 `semantic` 和 `code` 双向量及 payload，SQLite 保存增量指纹、身份、配置、任务和研判事实。修改共享模型前核对三处兼容性。使用新库或新布局时，单独验证旧库迁移；本地运行数据、托管源码和加密主密钥是业务数据。
- 领域服务持有领域事实。Web/REST/MCP 复用服务，Agent 步骤通过稳定 ID 引用原任务和报告。Embedding 与生成模型独立配置，前者的模型、维度和 collection 一起校验。

| metadata key | 语义 |
|---|---|
| `framework` | `spring / jaxrs / mybatis` |
| `visibility` | `public / private / protected / package / file-local` |
| `is_static / is_final / is_abstract / is_record / is_declaration` | 值为字符串 `"true"`，分别表示修饰、Java record 或 C 函数声明 |
| `is_entry_point / is_test / is_builtin` | 值为 `"true"`，标识入口、测试或库内建符号 |
| `return_type / param_types` | 返回类型、逗号分隔的参数类型 |
| `ann_<AnnotationName>` | 主注解属性，取 `value` 或 `path` |
| `docFile` | Markdown 文件基本名 |

## 接入、增量索引与检索

- 本地目录、单文件及托管归档复用索引管道。旧版覆盖 Java、C、C++（启发式）、Python、JavaScript、TypeScript、Markdown 和显式启用的 Java 字节码。策略为 `PRECISE / HEURISTIC / AUTO`，默认按语言能力优先精确解析。区分合法空文件、精确解析器不可用、可降级异常和无法解析。
- 同项目的索引、删除与监听任务串行。先扫描并标记 dirty，捕获内容指纹，再解析、增强元数据、替换图、生成 Embedding、写入并清理向量，最后为各成功且源码未变化的文件提交指纹。图的文件级替换保留稳定 ID 的外部入边。解析失败保留旧索引与重试资格。仅在确认文件消失或被目录替换时删除旧数据，语言筛选和读取失败不触发删除。
- 使用持久 dirty 标记和未完成项目删除记录，使清理可重试。旧监听任务在拿到锁后核对注册身份，停止或删除后不能重建项目。旧版跨存储操作按顺序恢复，故障期间各存储允许暂时不一致。
- HTTP 项目索引返回 202 并可轮询，重复运行返回 409，任务容量耗尽返回 503。状态为 `idle / running / done / partial / error`；只有无错误完成才是 done。启动时标记上个进程遗留的自动任务中断，保留已完成证据和等待审核状态，经显式操作重试。
- 支持关键词、自然语言语义、代码相似和 GraphRAG 检索。双向量输入分别来自签名和注解、原始源码；DOCUMENT 两种向量使用章节正文。GraphRAG 由向量及关键词召回，经 callers/callees 和可选影响面扩展、安全信号重排序。旧 `dataFlow` 查询参数兼容 `impactExpansion`。
- 支持按 `qualifiedName` 精确查符号，或按项目、相对文件路径、行号定位最贴近的 CodeUnit。图查询支持 callers、callees、impact、subtypes、入口点、死代码和测试缺口，同项目遍历。Context Pack 保留稳定 citation、来源、路径、行号、分数、截断及 `omittedReasons`；按字符预算分配给多个结果。
- 项目范围参与检索、候选排名和分页。Web 默认当前仓库，显式选择时才查全部已授权仓库；每条跨库结果携带来源 `projectId`。离线测评用独立语料快照。

## 账号、归档与外部执行

- 本地账号自助注册后等待管理员批准。账号停用或密码变更撤销旧会话。登录/注册限流，基于服务端识别的对端地址。Web 写操作受会话与 CSRF 保护，MCP 经相同认证并处理会话失效。
- 项目归属独立于代码、索引与运行。个人或有效组织的成员获得相应权限；成员移除和组织停用撤销访问。未分配项目仅管理员可见。授权校验覆盖 URL、正文、项目根、持久化资源 ID 及批量导出。
- ZIP/TAR.GZ 按格式和大小检查进入受控资产目录，拒绝路径穿越、绝对路径、重复目标、链接和特殊文件；限制条目数、目录深度、单文件和累计解压大小。单顶层目录可剥离后作为源码根。状态为 `INDEXING → READY | FAILED`；失败保留源码，删除需验证注册信息和状态。
- READY 资产画像汇总语言、文件分类、框架、SBOM、风险信号和扫描器推荐。可选数据源失败写入 `omittedReasons`。敏感配置只展示位置。人工排除优先，画像读取为显式只读。
- Semgrep、CodeQL 与 Slither 作为独立工具适配，使用参数数组、受控工作目录、超时与可取消子进程。CodeQL 仅使用无需项目构建的模式。Slither 报警可导入，Solidity 没有本地图谱时显式标记缺失。单工具失败隔离，未安装为 `UNAVAILABLE`。
- 扫描保留同步兼容入口及异步任务。任务可排队、按全局/项目/工具配额准入、取消和显式重试。重试只执行未成功工具，保留成功记录；已完成扫描器结果保留，重复报警按项目和 fingerprint 去重。任一工具部分成功时批次仍为 PARTIAL。

## 静态分析与审计

- 框架识别 Spring、JAX-RS 和 MyBatis。Spring 鉴权证据合并类和方法级路由与约束，保留被覆盖引用；沿项目内有限调用深度定位资源访问。静态结果只报告本地约束或策略候选、缺失证据，运行时鉴权结论需要额外证据。
- Java 按需生成方法内数据流、CFG 和轻量 PDG；C/Python 支持保守 CFG 和摘要。跨过程源码污点使用方法摘要与有界调用图传播，证据分 SOURCE、PROPAGATION、SINK，保存为独立记录。反射、动态代理、生成代码、C 宏和函数指针等存在静态解析局限。
- 方法内规则、跨过程污点和 SBOM × 离线 CVE 分别生成发现，共用 `VulnFinding`。创建为 SUSPECTED，经人工确认后进入 CONFIRMED，后续可 FIXED 或 DISMISSED。安全报告使用经确认记录。变体由已确认发现召回，只产生待核实候选。
- SBOM 支持 Maven、Gradle、npm 和 pip，导出 CycloneDX。质量视图展示启发式圈复杂度、耦合、包循环、热点、死代码和测试缺口；健康分按固定规则计算，图可导出 DOT/Mermaid。配置核查与主机威胁报告以输入文件生成结果，保持只读。
- `DetectionRule` 按版本保存 matcher、严重度、来源和正负样本，状态为 `CANDIDATE → IN_REVIEW → PUBLISHED | REJECTED`。发布要求回归样本全部符合预期，同规则最多一个活动版本；回滚恢复上一已发布版本，保留审计。Semgrep YAML 与 source-sink JSON 导出保持确定性，目标引擎方言需独立验证。

## 报警研判、人工审核与生成模型

- Semgrep JSON、SARIF/CodeQL 与工具适配结果归一为 `ExternalFinding`。原始报警保持只读；指纹为 `SHA256(tool|ruleId|filePath|startLine)[:16]`。导入限量，逐条定位、组装 Context Pack、增强证据并产生 `TRUE_RISK / LIKELY_FALSE_POSITIVE / NEEDS_REVIEW` 基线和置信度。
- 外部报警研判、审核快照和 Agent 共用 `TriageWorkflow`。定位优先项目内文件/行号，再按符号回退。历史反馈需匹配项目、指纹、代码版本和规则版本；规则抑制具备项目/路径作用域、有效期和创建/撤销审计。保护证据只有明确位于所有入口之后、所有目标之前时才能降低结论。各类证据写入 `decisionEvidence`。
- LLM 复核保持 `advisoryOnly`，保留原启发式报告。模型关闭、不可用、超时或输出无效时仍保留基线。发送前移除原始工具报文、脱敏并限制预算；输出引用只能使用输入证据。错误和日志经过脱敏，公开运行记录仅保存必要的引用、状态、额度和摘要。
- ReportSnapshot 一经创建冻结，包含 schema/tool/code/rule 版本。Markdown、JSON 和 PDF 引用同一事实；PDF 包含可读中文和长源码行。审核队列为 `PENDING → IN_REVIEW → CONFIRMED | REJECTED`，可退回 PENDING；条件迁移和审计同事务，人工写操作保留操作者、时间和理由。列表支持筛选分页，批量导出保留各快照状态。
- Agent 工作台从已有漏洞或外部报警启动 SAST_TRIAGE，按稳定 Run/Step ID 保存执行台账。步骤先落 RUNNING，随后原位更新终态；状态包括 QUEUED、RUNNING、WAITING_FOR_REVIEW、COMPLETED、PARTIAL、FAILED、CANCELLED。部分失败保留已有证据。页面可读时间线、导出运行记录、打开审核快照；模型建议无法改写漏洞事实或替代人工操作。
- 生成 Provider 由管理员选择，支持 Ollama Chat、OpenAI 原生和兼容 Chat Completions、Anthropic Messages。一个配置被选中，停用即暂停后续调用。连接编辑和切换不改变在途配置快照；密钥加密存储且不回显，地址或协议变更须在明确更新或清除密钥后生效。配置变更与管理审计同事务。
- 模型模板和发现只操作草稿，发现受认证、限额和时限约束，禁止转址；结果可选填，失败可继续手填。连接测试和生成是显式操作。未知单价允许研判，费用为 null；已知价格仍执行预算预检。审查、Wiki 和研判共用生成网关，保留各自的引用校验和输出约束。

## 变更评审、Wiki 与架构评审

- `POST /api/v1/change-reviews` 接受已索引项目、调用方提供的 unified diff、基线/目标版本和可选预算。解析新增、修改、删除、重命名和二进制标记，保留解析错误，按文件/hunk 确定性分组为有界 Unit。快照保留每个 hunk 的纳入/省略原因、当前索引映射、影响证据、版本身份和缺失项。版本只作为调用方声明，旧路径仍可供核查。
- Change Review 快照按项目隔离，状态为 COMPLETED、PARTIAL 或 FAILED。JSON/Markdown 来自同一冻结快照。diff、源码和工具错误经脱敏后才进入公开记录，版本缺失或未验证、删除及索引定位失败必须直陈。当前索引证据只支持有引用的变更结论和人工核实。
- `CHANGE_REVIEW` Playbook 复用冻结快照。模型只可在分配的 Unit 中以有限轮次、额度和总时限读已登记证据，或申请有限类型的验证；验证收据校验项目、快照和范围，默认验证服务返回不可用。只引用实际读过的证据，覆盖不足、工具不可用或取消时保留部分完成及已冻结结果。保留单元步骤、缺失信息和辅助建议，生成结论需要人工审核。
- Wiki 汇总项目/包结构，先生成可重算的确定性摘要，再按配置用模型补充架构摘要，支持阶段缓存和显式续跑。文档正文与目录携带版本、生成时间、来源及缺失原因；引用可回到项目内源码。MCP 旧版工具目录独立于 Wiki 页面。
- 架构评审基于复杂度、耦合、包循环和变更热点给出带引用的候选。支持普通 HTTP 与 SSE `phase / delta / result / complete`，终止错误保留服务端详情。公开增量为结构化输出，模型不可用仍返回静态指标。

## 对外入口与交互

REST 以 `/api/v1` 为前缀。下表保留主要路由族，具体能力对齐以 HTTP 契约和实际测试为准。

| 领域 | 路由族 |
|---|---|
| 仓库与索引 | `/projects`、`/projects/{projectId}/stats`、`/index/project`、`/index/project/status`、`/index/file`、`/assets` |
| 代码理解 | `/search/{keyword,semantic,code,graphrag}`、`/search/authorized`、`/symbol/{qualifiedName}`、`/locate`、`/graph`、`/context/pack`、`/summaries` |
| 分析与扫描 | `/flow`、`/sbom`、`/frameworks`、`/metrics`、`/export/graph`、`/vulns`、`/scanners`、`/scan-tasks`、`/scans`、`/config-audit`、`/threat-detection` |
| 研判与审核 | `/triage`、`/agent-runs`、`/review-queue`、`/rules`、`/change-reviews`、`/architecture/reviews` |
| 身份与模型 | `/auth`、`/admin`、`/admin/model-providers`、`/agent-settings/llm`、`/capabilities/generation` |
| 验证 | `/health`、`/benchmark/results` |

旧 MCP 工具覆盖 `list_projects`、`trigger_index`、`index_status`、`search_keyword`、`search_semantic`、`search_code`、`search_graphrag`、`build_context_pack`、`lookup_symbol`、`locate_at`、`find_callers`、`find_callees`、`find_subtypes`、`get_impact`、`find_entrypoints`、`analyze_flow`、`trace_taint`、`triage_finding`、`record_triage_feedback`、`list_triage_feedback`、`list_vulns`、`scan_vuln_code` 和 `get_health_report`。请求有统一时限，取消传播到在途查询。

Web 默认进入仓库工作台。仓库工作台、代码理解、缺陷发现、能力验证、平台管理共用项目范围；浏览器历史、刷新和旧统计深链可恢复。切换项目、筛选或任务时丢弃旧响应，区分加载、空结果、部分完成和请求失败。轮询保留焦点、阅读位置和展开状态；人工审核、删除、模型连接测试均由显式操作发起。主要交互支持键盘、窄屏、亮暗主题、中文和英文。

## 验收约定

| 范围 | 应验证的行为 |
|---|---|
| Parser 与索引 | 合法空文件、语法失败、删除和重命名、稳定 ID、项目隔离、增量跳过、脏数据重试、重启恢复、并发冲突 |
| 检索与图谱 | 同名符号按项目隔离，精确行定位，继承和实现分离，无歧义才连调用，引用与预算可追溯 |
| 身份与资产 | 审核、撤权、会话与 CSRF、归档限额和路径边界、已存在数据的兼容与持久化 |
| 扫描与审查 | 无工具、失败、超时、取消与重试；保留部分证据；冻结快照与导出一致；模型输出引用受限；人工状态迁移有审计 |
| 入口与集成 | 实际 HTTP 请求与 MCP stdio 进程，浏览器交互和专项真实服务集成分别验证。检索质量基线为语义 Hit@10 ≥ 65%、代码相似 Hit@10 ≥ 75% |

验证报告应区分通过、失败、跳过和未运行；打包结果只证明可以构建，集成检查要说明用到的真实服务与替身。旧问题和路线资料中的设想只在有实现证据时进入本基线。

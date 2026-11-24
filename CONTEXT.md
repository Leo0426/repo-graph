# RepoGraph TypeScript 重写基线

本文件记录 Java 版最后一版已实现的产品行为和重写验收标准。依据为旧 `main` 的 `3a332ef`，核对了 REST 控制器、MCP 工具目录、领域模型、测试与功能验收文档。以下能力是 TypeScript 重写的参考目标，当前交付状态以 TypeScript 代码及实际验证结果为准。从本仓库开始工作时先读本文；新增领域字段或改变已确认契约时同步更新本文。

## 产品目标与范围

RepoGraph 为开发者、编码 Agent 和研发安全团队提供基于仓库的代码理解、静态分析与人工研判。使用者可以接入仓库，检索符号和代码，用图谱、源码行号与引用核查结论，并对外部报警或变更进行有记录的人工审核。Web 与 REST 由应用提供，MCP 是独立 stdio 进程，经 HTTP 复用应用能力和权限。stdout 专用于 JSON-RPC，诊断走 stderr 或日志。

重写按可独立验证的主流程推进。先贯通项目接入、增量索引、关键词检索与源码定位，再扩展图谱、语义检索、资产与组织管理、静态分析、研判及审查。首个端到端验收用两个含同名符号的仓库，验证接入后可以从 REST 和 MCP 查到各自的证据，重启后仍可查询，增量更新和删除可核对。Web 界面、旧数据迁移和全部旧功能的对齐需要各自的验收证据。

## 领域契约与存储

- `projectId` 为规范化绝对项目根路径的 UTF-8 SHA-256 前 12 个十六进制字符。项目归属转移保留 ID。路径按项目根相对表示，以 `/` 分隔；源码行号从 1 开始。
- `CodeUnit` 包含 `id, kind, language, qualifiedName, simpleName, filePath, startLine, endLine, rawSource, signature, annotations, parentQualifiedName, metadata`。ID 为 `SHA256(projectId + filePath + kind + qualifiedName)` 的小写十六进制。C/C++ 函数原型计算 ID 时将 `#decl` 追加到全限定名，以区分同文件定义。空注解和 metadata 用空容器，顶层符号的 parent 为 null。Java 方法使用 `Type#method(params)`，嵌套类型使用 `Outer$Inner`。
- `CodeUnitKind` 为 `CLASS / INTERFACE / ENUM / ANNOTATION / METHOD / CONSTRUCTOR / FIELD / LOCAL_VAR / STRUCT / UNION / TYPEDEF / MACRO / FUNCTION / DOCUMENT`。Markdown 按 H1–H3 切为 DOCUMENT，`qualifiedName` 使用 `filePath#heading`，重名追加行号，语言为 `doc`。
- `RelationEdge` 包含 `sourceId, targetId, kind, resolved, filePath, sourceLine`。关系类型为 `CONTAINS / CALLS / IMPORTS / EXTENDS / IMPLEMENTS / DEFINES_TYPE / OVERRIDES`。继承与接口实现分别存储。调用目标有歧义时保留未解析状态，只持久化确定的 CALLS。
- 旧版 Neo4j 保存 CodeUnit、关系与项目范围，Qdrant 保存 `semantic` 和 `code` 双向量及 payload，SQLite 保存增量指纹、身份、配置、任务和研判事实。修改共享模型前核对三处兼容性。使用新库或新布局时，单独验证旧库迁移；本地运行数据、托管源码和加密主密钥是业务数据。
- 领域服务持有领域事实。Web/REST/MCP 复用服务，Agent 步骤通过稳定 ID 引用原任务和报告。Embedding 与生成模型独立配置，前者的模型、维度和 collection 一起校验。

| metadata key | 语义 |
|---|---|
| `framework` | `spring / jaxrs / mybatis` |
| `visibility` | `public / private / protected / package / file-local` |
| `is_static / is_final / is_abstract / is_record / is_declaration` | 值为字符串 `"true"`，分别表示修饰、Java record 或 C/C++ 函数声明。C/C++ 非静态函数保留 `is_static="false"` |
| `is_entry_point / is_test / is_builtin` | 值为 `"true"`，标识入口、测试或库内建符号 |
| `is_async / bases` | Python 异步定义标记 `"true"`，或类声明中的基类列表原文 |
| `return_type / param_types` | 返回类型、逗号分隔的参数类型 |
| `bytecode / is_synthetic / is_bridge` | 字节码来源、编译器生成符号、JVM 桥接方法，值为 `"true"` |
| `source_file / archive_entry` | JVM SourceFile 属性中的原文件名，或 JAR 内的类文件路径 |
| `ann_<AnnotationName>` | 主注解属性，取 `value` 或 `path` |
| `docFile` | Markdown 文件基本名 |
| `heuristic` | 值为 `"true"`，符号来自启发式声明识别 |

## 接入、增量索引与检索

- 本地目录、单文件及托管归档复用索引管道。旧版覆盖 Java、C、C++（启发式）、Python、JavaScript、TypeScript、Markdown 和显式启用的 Java 字节码。策略为 `PRECISE / HEURISTIC / AUTO`，默认按语言能力优先精确解析。区分合法空文件、精确解析器不可用、可降级异常和无法解析。
- 同项目的索引、删除与监听任务串行。先扫描并标记 dirty，捕获内容指纹，再解析、增强元数据、替换图、生成 Embedding、写入并清理向量，最后为各成功且源码未变化的文件提交指纹。图的文件级替换保留稳定 ID 的外部入边。解析失败保留旧索引与重试资格。仅在确认文件消失或被目录替换时删除旧数据，语言筛选和读取失败不触发删除。
- 使用持久 dirty 标记和未完成项目删除记录，使清理可重试。旧监听任务在拿到锁后核对注册身份，停止或删除后不能重建项目。旧版跨存储操作按顺序恢复，故障期间各存储允许暂时不一致。
- HTTP 项目索引返回 202 并可轮询，重复运行返回 409，任务容量耗尽返回 503。状态为 `idle / running / done / partial / error`；只有无错误完成才是 done。启动时标记上个进程遗留的自动任务中断，保留已完成证据和等待审核状态，经显式操作重试。
- 支持关键词、自然语言语义、代码相似和 GraphRAG 检索。语义向量使用声明签名、注解、文档摘要和父类型上下文。代码向量使用原始源码。DOCUMENT 两种向量使用章节正文。GraphRAG 由向量及关键词召回，经 callers/callees 和可选影响面扩展、安全信号重排序。旧 `dataFlow` 查询参数兼容 `impactExpansion`。
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
| 仓库与索引 | `/projects`、`/projects/{projectId}/stats`、`/index/project`、`/index/project/status`、`/index/file`、`/watch`、`/assets` |
| 代码理解 | `/search/{keyword,semantic,code,graphrag}`、`/search/authorized`、`/symbol/{qualifiedName}`、`/locate`、`/graph`、`/context/pack`、`/summaries` |
| 分析与扫描 | `/flow`、`/sbom`、`/frameworks`、`/metrics`、`/export/graph`、`/vulns`、`/scanners`、`/scan-tasks`、`/scans`、`/config-audit`、`/threat-detection` |
| 研判与审核 | `/triage`、`/agent-runs`、`/review-queue`、`/rules`、`/change-reviews`、`/architecture/reviews` |
| 身份与模型 | `/auth`、`/admin`、`/admin/model-providers`、`/agent-settings/llm`、`/capabilities/generation` |
| 验证 | `/health`、`/benchmark/results` |

旧 MCP 工具覆盖 `list_projects`、`trigger_index`、`index_status`、`search_keyword`、`search_semantic`、`search_code`、`search_graphrag`、`build_context_pack`、`lookup_symbol`、`locate_at`、`find_callers`、`find_callees`、`find_subtypes`、`get_impact`、`find_entrypoints`、`analyze_flow`、`trace_taint`、`triage_finding`、`record_triage_feedback`、`list_triage_feedback`、`list_vulns`、`scan_vuln_code` 和 `get_health_report`。请求有统一时限，取消传播到在途查询。

Web 默认进入仓库工作台。仓库工作台、代码理解、缺陷发现、能力验证、平台管理共用项目范围；浏览器历史、刷新和旧统计深链可恢复。切换项目、筛选或任务时丢弃旧响应，区分加载、空结果、部分完成和请求失败。轮询保留焦点、阅读位置和展开状态；人工审核、删除、模型连接测试均由显式操作发起。主要交互支持键盘、窄屏、亮暗主题、中文和英文。

设计或修改 Web 页面、工具栏、分段控件、文稿排版与源码引用时，按指南核对布局、视觉参数、交互状态与验收方法。[Web 设计指南](docs/web-design.md)

## 验收约定

| 范围 | 应验证的行为 |
|---|---|
| Parser 与索引 | 合法空文件、语法失败、删除和重命名、稳定 ID、项目隔离、增量跳过、脏数据重试、重启恢复、并发冲突 |
| 检索与图谱 | 同名符号按项目隔离，精确行定位，继承和实现分离，无歧义才连调用，引用与预算可追溯 |
| 身份与资产 | 审核、撤权、会话与 CSRF、归档限额和路径边界、已存在数据的兼容与持久化 |
| 扫描与审查 | 无工具、失败、超时、取消与重试；保留部分证据；冻结快照与导出一致；模型输出引用受限；人工状态迁移有审计 |
| 入口与集成 | 实际 HTTP 请求与 MCP stdio 进程，浏览器交互和专项真实服务集成分别验证。检索质量基线为语义 Hit@10 ≥ 65%、代码相似 Hit@10 ≥ 75% |

验证报告应区分通过、失败、跳过和未运行；打包结果只证明可以构建，集成检查要说明用到的真实服务与替身。旧问题和路线资料中的设想只在有实现证据时进入本基线。

## TypeScript 首批实现

Node.js 24+ 运行。使用 SQLite 保存索引和 FTS5 关键词检索，在新的数据库目录中启动。当前解析 TypeScript、JavaScript、Java、Python、C、C++ 和 Markdown，提供异步目录索引、项目列表与删除、关键词检索、符号和行号定位。同名精确查询跨项目有歧义时返回 409。

目录索引、单文件索引和归档接受 `strategy=auto|precise|heuristic`，MCP 的 `trigger_index` 和工作台也可选策略。启发式模式识别完整的声明范围，沿用 `相对路径#符号名@L行号` 和 `heuristic="true"`，保留源码位置；关系需要精确解析。Markdown 和 Java 字节码继续使用各自的解析器。

自动模式先尝试精确解析，合法空文件视为成功。如果文件已有精确索引，解析失败时保留最近一次精确结果。其他文件发生可恢复错误且识别到完整声明时，保留降级符号，状态为 `partial`，并增加 `degradedFiles` 及原解析错误，后续增量索引继续尝试精确解析。Java 语法错误在自动模式下保留失败状态。切换精确与启发式时，同一份源码会按目标策略重新索引。文件监听和默认归档重建沿用最近一次全项目索引的策略。

应用只监听 `127.0.0.1`。索引根由 `REPOGRAPH_PROJECTS_ROOT` 指定，项目根经真实路径校验，不跟随仓库中的符号链接。默认数据库为 `~/.repograph/typescript/index.db`，可通过 `REPOGRAPH_DB_PATH` 指定独立路径。

```sh
npm ci
npm run build
export REPOGRAPH_PROJECTS_ROOT=/absolute/path/to/projects
export REPOGRAPH_ACCESS_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
npm start
```

可通过 `REPOGRAPH_ADMIN_PASSWORD` 为内建 `admin` 设置初始密码，至少 12 字符且最多 72 个 UTF-8 字节。数据库已有密码时沿用该密码。开发启动可使用管理员密码、上面的 `REPOGRAPH_ACCESS_TOKEN` 或两者。访问令牌是独立的管理员凭据，REST 以 `Authorization: Bearer` 提交。管理员使用 `POST /api/v1/index/project?projectRoot=...` 提交接入，随后读取响应的 `pollUrl`。用 `GET /api/v1/projects` 获取可见项目 ID。

任务运行时，轮询接口返回 `stage`、`done`、`total`、`pct`、`processedFiles` 和 `totalFiles`。工作台显示扫描、处理文件、当前文件向量和保存阶段。向量进度计入已获取完整双向量的符号，文件计数反映整个任务。任务结束后返回最终统计。重启后的中断任务保留中断状态。

管理员也可用 `POST /api/v1/index/file` 同步索引单个源码文件。`file` 和 `projectRoot` 为绝对路径，文件必须在允许索引的本地目录内。增量判断、并发限制和失败重试沿用项目索引。解析前持久化待重试记录，源码和向量成功更新后在同一 SQLite 事务中清除记录。读取失败或符号链接替换会保留旧数据。确认删除会同时清理索引和待重试记录。

本地仓库概览支持启动和停止文件监听。管理员可通过 `POST /api/v1/watch` 传入 `projectId` 与 `root` 启用，`DELETE /api/v1/watch/{projectId}` 停止。`GET` 接口只返回有权访问的项目。监听使用递归文件事件合并变更，并每 30 秒校对一次。启用记录持久化，服务启动时恢复并补扫离线变更。停止会取消在途自动任务，已提交的文件索引继续可查询。删除整个仓库索引会一并移除监听记录。

MCP 客户端使用 `node /absolute/path/to/repo-graph/dist/mcp.js` 作为 stdio 命令。传入 `REPOGRAPH_USERNAME` 和 `REPOGRAPH_PASSWORD` 时使用获批账号登录，会话失效后尝试重新登录一次。传入 `REPOGRAPH_ACCESS_TOKEN` 则使用管理员访问令牌。应用端口默认为 8080，可设置 `REPOGRAPH_PORT`，MCP 的 `REPOGRAPH_BASE_URL` 随应用地址配置。

SQLite 同时保存 TypeScript/JavaScript 代码关系。同文件调用由 AST 和类型检查器绑定。跨文件调用通过相对 ES import 和已索引的导出解析，精确文件名优先，候选同级冲突时保留未解析引用。图谱支持具名和通配重导出、导入后再导出、显式转发默认导出，以及通过命名空间对象引用嵌套成员。重导出链最多解析 12 跳。显式导出优先，多条路径到达同一个声明时只保留一条关系。同名命名空间指向不同模块时，即使只有一处声明了成员也保留歧义。仅类型导出只能用于类型引用。调用方、转发文件和实现文件可独立增量更新。已有索引在下一次精确索引时补充重导出关系，保留稳定 CodeUnit ID。

TypeScript 和 JavaScript 的裸导入及重导出按所在目录就近读取仓库内的 `tsconfig.json`。支持 `paths`、`baseUrl` 和仓库内的相对 `extends`。精确规则优先于通配规则，通配规则取最长匹配前缀，目标按声明顺序查找。目录索引、监听或 `POST /api/v1/index/file` 单独索引 `tsconfig.json` 均可更新别名，无需重新解析未修改的调用方。配置读取或解析失败时保留最近的映射并报告部分完成，确认配置删除后重新按目录查找。已有索引在下一次精确索引时识别裸导入。

图谱还使用最近的 `package.json` 解析私有 `imports` 和包名自引用的 `exports`。支持精确子路径、通配、默认 Node ES import 条件和 `null` 屏蔽。解析结果只连接包内的已索引文件。数组在遇到有效目标后停止，即使对应文件尚未入库。项目索引、监听和单独索引 `package.json` 均可更新关系。

REST 提供 `GET /api/v1/graph/{callers,callees,subtypes,impact,symbols}`。遍历接受 `target`（全限定名或 CodeUnit ID）及可选 `projectId`，同名目标有歧义时返回 409。子类型查询只返回直接继承或实现，调用和影响面最多遍历 12 层、返回 500 个单元。MCP 增加 `find_callers`、`find_callees`、`find_subtypes` 和 `get_impact`。包内配置继承、基于项目引用选择配置、跨包查找、自定义解析条件、动态属性名及运行时分派仍待扩展。

Java `.java` 源码由 Tree-sitter WASM 在 Node.js 中解析。目录和归档默认包含 Java，也可传 `lang=java`。类、接口、枚举、record、注解、字段、构造器和方法沿用全限定名与行号契约。图谱连接明确的包和导入类型、直接继承与接口实现、签名匹配的直接覆写、本类调用和可见的跨文件静态调用。

实例调用根据参数、字段、局部变量和显式类型转换确定接收者，并按可判断的实参类型匹配直接声明的重载。`var` 可以从直接构造或转换表达式确定类型。局部声明按词法范围生效，局部同名类型及跨文件重复类型保留未解析。显式 `super` 支持直接父类方法和直接父接口的默认方法。无接收者或使用 `this` 的调用也可沿同文件父类链查找可访问的精确签名。

链式调用从同文件已解析声明取得返回类型。返回类型已确定时，下一跳可查询同文件或项目内其他文件的符号。跨文件中间调用、未解析的隐式类型和无法确定的泛型返回类型会中止后续推断，已确定的调用仍可查询。`Type::method` 和绑定接收者的方法引用在能唯一确定声明时记录为潜在调用关系。跨文件方法引用可连接公开声明，遇到重载竞争时保留未解析。

顶层类中没有本类声明和显式父类型竞争时，单一来源的具名静态导入和静态通配导入可建立调用关系。同包访问按包校验，多来源或重复类型保留未解析。已有 Java 源码索引在下一次精确解析时补充关系，保留符号 ID。

普通通配导入从项目内已索引的公开顶层类型中查找候选。同包类型优先。多个可见候选会保留未解析，即使只有其中一个声明了被调用的方法。常见的隐式 java.lang 类型也会阻止连接到普通通配导入的同名类型。候选文件增删和可见性变化会在图查询中生效。嵌套类型通配导入、依赖通配类型推断实参的重载、跨类型字段链、跨文件的隐式继承查找、泛型特化和运行时分派仍有解析限制。

工作台的代码图谱可按符号分析方法内流程。REST 使用 `GET /api/v1/flow/analyze?projectId=…&target=…`，MCP 使用 `analyze_flow`。目标为全限定名或 CodeUnit ID，同名重复时按 ID 消歧。分析读取索引保存的源码，返回参数、字段和返回值引用、带绝对行号的 CFG，以及 Java 的轻量 PDG。Java 数据依赖沿 CFG 汇总可达定义，控制依赖按分支和循环的语法范围记录。C 与 Python 提供保守的 CFG 和摘要。

CFG 覆盖条件分支、循环、退出和继续语句，以及常见 `switch`、`try` 与 `finally` 路径。显式返回会按其退出目标经过清理路径。异常分派保守处理，表达式内分支、带标签跳转和隐式资源清理标记为限制。每次分析最多接受 128 KiB 源码和 500 个图节点，超限返回 413。缺失方法体、字节码和不受支持的语言返回 404。

跨过程参数追踪使用 `GET /api/v1/flow/taint?projectId=…&source=…` 或 MCP `trace_taint`。入口为已索引 Java 源码方法，接受全限定名或单元 ID。默认从第 0 个参数出发，最大深度默认 6、上限 15。返回每一步的方法、实参或返回值位置及项目相对源码行。按索引中的调用行号选择目标，遇到同一行的同名调用或无法确定的重载时保留歧义。外部调用的候选终点沿用旧版方法名提示，结果报告名称匹配和顺序不敏感等限制。返回值路径止于当前方法。单次最多分析 200 个方法和 4 MiB 索引源码，返回最多 50 条路径。未展开的路径通过 `truncated` 或 `limitations` 说明。

显式传入 `lang=class` 可索引 `.class` 和 `.jar`，也可设 `includeBytecode=true` 加到原语言范围。工作台在本地索引和归档导入中提供该选项，单文件索引根据扩展名决定。启用后会遍历 `build/` 中的字节码，监听沿用最近一次手动目录索引选择。符号仍使用 `language=java`，通过 `metadata.bytecode` 标识来源。代码解析和 JAR 读取均在 Node.js 中完成，无需 JVM、编译或加载目标类。

字节码图谱按 JVM 描述符匹配已索引的构造器、重载、直接调用、继承、接口及内部类。Lambda 从 JVM bootstrap 元数据取得目标。JAR 内优先连接本归档的定义，跨文件只连接项目内唯一的字节码类。源码和字节码分别保留符号与引用，图谱同名时可按 CodeUnit ID 查询。JAR 路径保存在 `filePath`，类文件路径保存在 `archive_entry`，按源码行号定位时 REST 与 MCP 另传 `archiveEntry`。没有调试行号时保留签名。当前未回填同目录或其他目录的 Java 原文，JAR 只索引基础版本的类，不读取多版本条目或嵌套依赖 JAR。单个类限 1 MiB，JAR 限 32 MiB、10,000 个条目、64 MiB 展开字节码，并按文件限制符号和调用数量。解析失败保留旧索引并标为待重试。

Python 保留顶层函数的 `METHOD` 类型，类方法使用 `Class#method`，嵌套类使用 `Outer.Inner`。索引提取装饰器、类型提示、异步标记和 `__main__` 守卫中直接调用的入口。图谱连接可判断的本地调用、`self`/`cls` 方法、基类和项目内显式模块引用。动态导入、通配导入和运行时重绑定仍有解析限制。

C `.c`/`.h` 与 C++ `.cc`/`.cpp`/`.cxx`/`.hpp` 等由各自的 Tree-sitter 语法解析。索引提取函数、原型、类或结构体、联合体、枚举、类型别名、字段和宏。C++ 函数限定名保留命名空间、参数和尾部类型限定词。直接 C 调用可以跨文件连到唯一且与本地或直接引用头文件的原型匹配的定义。C++ 支持同文件无重载歧义的调用和类型关系。编译参数、系统头文件、间接头文件、条件宏展开、函数指针与 C++ 跨编译单元重载解析仍待覆盖。

通过 `GET /api/v1/graph/entrypoints` 或 `GET /api/v1/frameworks/{projectId}` 查询检测到的入口，并可用 `lang`、`limit` 和 `offset` 筛选分页。MCP 提供 `find_entrypoints`。Java 框架和入口标记来自源码注解、`main` 签名及已知框架回调接口线索。C 保留旧版的 `main` 与入口命名启发式，C++ 识别全局 `main`。JavaScript 和 TypeScript 沿用旧版的 `main`、入口前缀与回调后缀约定，覆盖有方法体的函数、箭头函数和类方法。参数均显式标注时，TypeScript 保存类型列表。下一次精确解析为已有 JavaScript 和 TypeScript 符号补充这些字段，符号 ID 保持稳定。

配置 `REPOGRAPH_EMBEDDING_MODEL` 和 `REPOGRAPH_EMBEDDING_DIMENSIONS` 启用双向量检索。Ollama 基地址通过 `REPOGRAPH_EMBEDDING_URL` 设置，默认 `http://127.0.0.1:11434`。语义向量结合符号名称、来源文件、签名、注解，以及声明和父类型的文档摘要。摘要取自 TypeScript/JavaScript 的 JSDoc、Java 的 Javadoc、C/C++ 的文档注释及 Python 的 docstring。代码向量继续使用源码。使用需要查询前缀的模型时，通过 `REPOGRAPH_EMBEDDING_QUERY_PREFIX` 为自然语言查询添加模型要求的前缀。模型、维度、服务地址和向量输入协议共同标识索引，旧协议的向量在下次增量索引时重建。SQLite 在项目和其他过滤条件内进行精确余弦排序。修改文件的向量生成失败时，保存新源码和图谱、移除旧向量，索引标记为 partial，后续增量索引补齐。

语义检索按声明向量余弦相似度的 80% 与整段源码向量余弦相似度的 20% 排序。代码相似检索还为长代码单元保存最多三个局部源码窗口。长函数、方法和构造器可另外保存声明签名向量。代码相似排序取整个单元、局部窗口和签名中最高的相似度，返回完整代码单元。文档章节继续使用段落正文的向量。

REST `/api/v1/search/semantic` 和 `/api/v1/search/code` 分别支持语义与代码相似分页检索。向量未启用或服务异常时返回 503 和对应错误码。GraphRAG 与 Context Pack 在这些情况下继续使用关键词和图谱，并在 `omittedReasons` 写明原因。默认重排序将安全分乘以 0.5 后加入综合分。设置 `rerank=false` 时按召回与扩展顺序返回，综合分只使用基础相关性。安全高亮单独统计安全分严格大于 0.3 的结果。Context Pack 提供带项目、路径和行号的编号引用；单个长片段按预算裁剪。四个对应 MCP 工具为 `search_semantic`、`search_code`、`search_graphrag` 和 `build_context_pack`。

先索引语料并配置 Embedding，再运行 `npm run benchmark -- --project 项目ID`。内置用例针对 RepoGraph 的 TypeScript `src/` 快照，包含 23 个语义检索用例和 8 个代码相似用例。评测其他语料时传入 `--cases /路径/cases.json`，JSON 的 `semantic` 和 `code` 各包含至少一项 `{id, description, query, expectedPatterns: [...]}`。命令沿用本地应用的 `REPOGRAPH_ACCESS_TOKEN`，目标地址取 `REPOGRAPH_BASE_URL`，默认地址为 `http://127.0.0.1:8080`。评测经对应 REST 搜索计算 Hit@1/3/5/10 与 MRR@10。相关性按限定名子串判定，忽略大小写。Hit@10 阈值分别为 65% 和 75%。命令退出码 1 表示结果已保存但未达阈值，2 表示评测未完成。

评测保存指标、查询描述、首条符号名、语料用例指纹和实际服务声明的模型、维度与检索配置指纹。查询期间检索配置或项目索引改变时结束评测，保留上一份结果。结果写入与 `REPOGRAPH_DB_PATH` 同目录的 `benchmark-latest.json`，服务和命令也可以共用 `REPOGRAPH_BENCHMARK_RESULTS` 指向指定文件。`GET /api/v1/benchmark/results` 和工作台读取同一份报告。带项目 ID 的报告按项目权限可见。管理员可指定旧报告文件读取历史结果。

在同一份包含 95 个文件、2,047 个代码单元的源码快照上，用真实 Ollama 复测了内置用例。`qwen3-embedding:0.6b` 的语义 Hit@10 为 69.6%（16/23），代码相似 Hit@10 为 100%（8/8）。配置使用 1,024 维，并将 `REPOGRAPH_EMBEDDING_QUERY_PREFIX` 设为 `Instruct: Given a description of code behavior, retrieve the declaration that implements that behavior.`、换行和 `Query:`。同一语料下 `unclemusclez/jina-embeddings-v2-base-code:q8` 使用 768 维且无前缀，语义 Hit@10 为 56.5%，代码相似 Hit@10 为 87.5%。修改模型或索引语料后应重新运行评测。

Web 工作台位于 `http://127.0.0.1:8080/`，支持账号注册、等待管理员审批、登录和修改密码。管理页可审核账号、维护组织及成员、分配仓库归属并查看审计。账号密码使用带盐 scrypt 存储。登录与注册按连接地址限流，浏览器会话使用 HttpOnly Cookie，同源写操作校验 CSRF 令牌。停用账号、修改密码或进程重启会使原会话失效。

工作台支持仓库增量索引、状态轮询、仓库概览、四种检索模式、关系查询和证据包。普通账号只看到个人归属或有效组织授予的项目。检索默认当前仓库，`/api/v1/search/authorized/*` 在排序和分页前应用服务器维护的授权范围，向量查询返回前重新校验。旧 `#stats=<projectId>` 和源码深链可以同样在权限范围内打开。

管理员可在 Web 仓库页上传 ZIP 或 TAR.GZ，也可向 `POST /api/v1/assets/import` 提交名为 `file` 的 multipart 文件。应用按实际格式解压到托管目录，同一归档可形成独立项目，单顶层目录作为源码根。默认托管目录为数据库路径加 `-assets`，可通过 `REPOGRAPH_ASSETS_ROOT` 指定。默认限制为上传 200 MiB、总解压 1024 MiB、单文件 50 MiB、50,000 个条目与 32 层目录。相应环境变量为 `REPOGRAPH_ASSET_MAX_UPLOAD_MIB`、`REPOGRAPH_ASSET_MAX_EXTRACTED_MIB`、`REPOGRAPH_ASSET_MAX_FILE_MIB`、`REPOGRAPH_ASSET_MAX_ENTRIES` 和 `REPOGRAPH_ASSET_MAX_DEPTH`。

`GET /api/v1/assets/{assetId}` 返回索引状态，部分完成的详情保留在 `indexResult`。就绪资产的 `/profile` 返回文件分类、语言及构建系统、依赖资产、疑似敏感配置路径和扫描器建议。缺失的数据列在 `omittedReasons`，清单读取或解析失败列在 `dependencyIssues`。读取沿用项目授权。删除托管资产会先清除索引，再清理托管副本；清理失败可以重试。

就绪资产的 `GET /api/v1/assets/{assetId}/authorization-evidence` 供获授权的成员查询 Spring 路由、鉴权约束和资源访问的源码引用。路由合并类与方法的首个路径，HTTP 方法取自映射注解。方法级约束优先，类级约束仍保留引用。配置线索以经脱敏的候选返回。资源访问按项目内已解析调用追踪，`depth` 默认为 6，范围为 0–12，每条路由最多分析 200 个方法。结果记录静态分析缺失的运行时证据。

管理员可从归档画像重建索引，或调用 `POST /api/v1/assets/{assetId}/reindex`。接口返回 202 和原资产的轮询地址。重建读取该资产现有的托管副本，保留归属、历史记录和资产 ID。解析错误与部分完成结果显示在归档画像。REST 可通过 `lang` 和 `includeBytecode` 指定索引范围。

配置 `REPOGRAPH_SEMGREP_RULES` 为服务端本地规则文件的绝对路径，安装 Semgrep CE，并按需使用 `REPOGRAPH_SEMGREP_BINARY` 指定可执行文件的绝对路径。默认从服务端 PATH 查找 Semgrep。工具在临时工作目录中读取就绪资产的托管源码，使用操作方指定的规则文件，忽略归档的 Git 和 Semgrep 忽略配置，并禁用指标上报和版本联网检查。已用 Semgrep CE 1.186.0 验证扫描和结果导入。[Semgrep CLI 文档](https://docs.semgrep.dev/cli-reference)

配置 `REPOGRAPH_CODEQL_BINARY` 为服务端已安装 CodeQL Bundle 的可执行文件绝对路径。CodeQL 从临时源码副本创建数据库，支持 JavaScript、TypeScript、Java、Python、C# 和 Ruby。源码副本排除构建脚本及依赖清单，每个源文件最多 4 MiB，合计最多 128 MiB 和 20,000 个文件。每种提取器使用 `--build-mode=none`，从本地查询包生成 SARIF 2.1.0，保留成功语言的结果。Java 与 Python 提取分别需要服务端 PATH 中的 JDK 和 Python 3。Kotlin 可由 Semgrep 分析。[CodeQL 数据库创建](https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-cli-manual/database-create) · [CodeQL 提取器环境要求](https://docs.github.com/en/code-security/tutorials/customize-code-scanning/prepare-code-for-analysis)

已用 CodeQL 2.27.5 为六种语言分别验证归档接入、任务执行、SARIF 读取和运行记录入库。成功样本的报警数均为 0。多语言任务中单个提取器失败后保留其他语言结果的行为由协议替身测试覆盖。

配置 `REPOGRAPH_SLITHER_BINARY` 和 `REPOGRAPH_SOLC_BINARY` 为服务端可执行文件的绝对路径。Slither 使用 solc 直接编译临时目录中的 Solidity 文件，支持归档内的相对导入，按文件头识别并跳过 macOS AppleDouble 元数据。编译范围限定在临时源码目录，归档中的构建脚本和工具配置不参与执行。每份源码最多 2 MiB，合计最多 64 MiB 和 2,000 个文件。依赖 Hardhat、Foundry 等框架配置或外部依赖的项目可导入事先生成的 Slither JSON。已用 Slither 0.11.6 和 solc 0.8.39 验证多文件编译、报警入库和研判详情。[Slither 用法](https://github.com/crytic/slither/blob/master/docs/src/Usage.md) · [Solidity 导入路径](https://docs.soliditylang.org/en/latest/path-resolution.html)

就绪归档概览可发起 Semgrep、CodeQL 或 Slither。REST `POST /api/v1/assets/{assetId}/scan-tasks` 返回 202 和任务地址，兼容同步入口为 `POST /api/v1/assets/{assetId}/scans`。请求可指定 `scanners`，留空时采用画像推荐的受支持工具。可用 `timeoutSeconds` 设置每个工具的执行时限，默认及上限均为 120 秒。一次只运行一个任务，最多接收八个排队和运行中的任务，每项目最多一项。工具能力由 `GET /api/v1/scanners/capabilities` 返回。

任务可取消，失败、部分成功或取消后可显式重试。重试沿用任务 ID，创建新批次，略过已成功的工具并保留此前已捕获的报警。每个工具结束时同事务保存运行记录、归一后的报警和任务进度。进程中断后的活动任务标记为失败，等待显式重试。每份工具报告最多接收 8 MiB，每项任务最多保留 1,000 条报警，按项目和指纹去重。工作台任务详情轮询运行状态，报警可从已有研判入口打开。

仓库概览可以生成、预览并下载 CycloneDX 1.4 SBOM。认证接口 `GET /api/v1/sbom/{projectId}` 从已注册项目根目录读取清单。兼容参数 `projectRoot` 必须与注册路径一致，`format` 仅接受 `cyclonedx`。同一项目可包含多种生态，当前识别根 `pom.xml`、Gradle 脚本及版本目录和锁文件、npm 清单及锁文件、`pyproject.toml` 及 `requirements*.txt`。每项依赖保留来源文件，版本范围以属性记录。

Gradle 读取设置文件中以字面量声明的子项目，以及用 `projectDir = file("…")` 声明的项目内路径。每个子项目读取常规构建脚本和锁文件，并使用根版本目录解析别名。清单只读取仓库内的普通文件，符号链接、无法静态解析的目录和超限项计入问题。动态 Gradle 依赖及自定义构建文件仍待覆盖。

Maven 按根 POM 和嵌套 POM 的 `modules` 读取子模块。只在仓库内按 `relativePath` 或默认 `../pom.xml` 找到坐标匹配的父 POM 时应用本地继承。依赖清单保留声明、使用和管理版本的 POM 路径。无法解析的模块和父继承作为缺失证据记录。远程父 POM、导入的 BOM、传递依赖以及基于环境激活的 profile 需要额外解析。

npm 工作区从根 `package.json` 选择成员，支持目录、`*`、`?`、递归 `**` 和 `!` 排除。成员使用根锁文件中按目录最近的记录，匹配后保留锁文件及成员声明路径。确认指向本工作区的内部链接不计入外部依赖。坏锁文件或缺少匹配记录时仍保留声明及原版本范围。其他 glob 语法、pnpm 与 Yarn 锁文件仍待覆盖。

工作台的依赖清单可按项目检查 Maven 公告。REST 使用 `POST /api/v1/vulns/scan/deps?projectId=…`，MCP 提供 `scan_dependency_advisories`。检查只读取仓库清单并匹配本地公告库，包含 Maven 和 Gradle 的依赖。Gradle 锁定版本在所属子项目或根项目内优先，测试依赖和未引用的版本目录条目排除。版本范围、未解析版本与无法比较的限定符计入未核验组件。公告区间包含起始版本、排除修复版本。内置公告沿用 Java 版随附的 80 条记录，匹配以该目录和当前清单证据为准。

匹配项以 `SUSPECTED` 写入漏洞库存，保存公告来源、依赖版本、PURL 与清单路径。按项目、依赖坐标、版本和公告去重，重复检查保留人工确认与处置。返回检查、匹配、新增及未核验数量，以及最多 50 条可打开的库存记录。清单错误或超限在结果中单独列出。

`POST /api/v1/config-audit/reports` 接受 `{ files: [{name, content}], dimensions?: [...] }`。规则目录沿用旧版 16 条配置规则及其 ID、级别和整改文本。每个文件按所选维度的规则检查，缺失键的行号为 `null`，其他结果引用原行号。返回已核查维度、规则数、文件数及按文件和行号排序的发现。

`POST /api/v1/threat-detection/reports` 接受 `{ logs: [{name, content}], outboundWhitelist?: [...] }`。读取已提交的认证和出站连接日志，保留旧版规则 ID。SSH 登录失败按单份日志聚合，达到五次时记录首条证据和总数。IPv4 允许列表支持精确地址和 CIDR。报告引用原文件、行号和可识别时间，只显示匹配所需的字段。两种报告均需认证，每次最多 32 个文件、1 MiB 请求和 5,000 条结果。输入及报告仅在请求期间处理。

仓库概览提供代码质量分析及 DOT、Mermaid 下载。REST 使用 `/metrics/{complexity,coupling,cycles,hotspots,report}`、`/graph/{deadcode,testgaps}` 和 `/export/graph?format=dot|mermaid`，均需 `projectId`。MCP 的 `get_health_report` 复用报告接口。复杂度是从索引源码识别条件、分支、循环和逻辑短路的近似值。耦合按索引中的跨类型调用去重，包循环及导出图按 Java 包或其他语言的项目相对目录聚合。测试缺口检查从测试代码出发六跳内可达的生产方法，疑似未调用基于入边和已标记入口，均需结合运行证据核实。

变更热点用本地 Git 最近 1,000 个提交中的变化次数与平均圈复杂度计算，托管归档和没有可读 Git 历史的项目返回空结果。健康分沿用旧版扣分阈值，并按活动漏洞库存中的疑似和确认记录计算严重度扣分。已修复或忽略的记录退出活动计数。

工作台的变更评审接受 unified diff，也可向 `POST /api/v1/change-reviews` 提交 JSON，包含 `projectId`、`diff` 和可选的 `baseVersion`、`targetVersion`、`source`。可用 `maxUnits`、`maxHunksPerUnit` 和 `budgetChars` 调整规划，默认分别为 20、4 和 12,000。二进制、合并 diff、仅删除行和超出预算的变更在快照中标明证据缺失。评审核对新增行与当前索引的实际文本，并采集同项目的符号及直接上下游引用。版本字段为调用方声明。

快照的 diff 和源码片段应用常见凭据脱敏，敏感配置路径的 diff 内容整体遮盖。`GET /api/v1/change-reviews/{id}?projectId=…` 读取已经冻结的快照，`/export?projectId=…&format=json|markdown` 复用同一份数据。工作台可用 `?view=change-review&project=…&snapshot=…` 重开评审，读取和导出均校验项目权限。重建索引保留已有快照，移除项目索引时一并移除快照。

工作台可基于冻结快照单独启动模型评审。`POST /api/v1/agent-runs/change-review` 接受 `projectId` 和 `snapshotId`，也兼容创建快照的请求体。任务最多处理 25 个单元，每单元最多 3 轮。模型只可读取该单元的脱敏证据并引用已读取的引用 ID。回归与安全防护验证请求以项目、快照和单元为范围，当前返回隔离验证不可用。建议供人工参考，模型步骤、建议和取消状态经 `/api/v1/agent-runs/{id}` 读取。`POST /api/v1/agent-runs/{id}/cancel` 取消在途调用并保留已有步骤及原快照。

外部报警通过工作台上传文件，也可向 `POST /api/v1/triage/findings/import?projectId=…&format=semgrep|sarif|codeql|slither` 提交原报告 JSON。导入限 8 MiB 和 1,000 个条目，支持 `codeVersion` 和 `ruleVersion` 声明。SARIF 解析项目相对位置、源根和内嵌 artifact 索引。Slither 从主检测元素读取项目相对路径和行号范围，研判标记 Solidity 索引不可用。无效位置、路径越界和非本地 URI 单独计入跳过项。报警按项目和指纹去重，保留首条规范化记录，原报告正文及工具的源码字段不入库。清理项目时一并清理报警。[Slither JSON 格式](https://github.com/crytic/slither/blob/master/docs/src/api/JSON-output.md)

`GET /api/v1/triage/findings` 可分页并按工具和严重度过滤。`/triage/findings/{fingerprint}?projectId=…` 优先按相对路径和行号定位当前索引，亦可按报告符号回退，输出脱敏证据包和研判结论。`POST /api/v1/triage/report` 可直接预览报告中的同类结果。MCP 的 `triage_finding` 支持两种读取方式。Markdown 预览与 JSON 共用研判结果，并包含置信度、证据引用、反馈应用状态和缺失信息。新变更快照冻结同项目、同路径且与新增行重叠的报警引用；已声明且与目标不同的版本不参与关联。版本相同只确认声明一致。

带代码和规则版本的报警可在详情中记录人工反馈。`GET/POST /api/v1/triage/feedback` 与 MCP 的 `record_triage_feedback`、`list_triage_feedback` 共用记录。每个项目和指纹保留最新反馈。代码及规则版本均有值且精确一致时才复用，版本有差异时在证据中标记跳过。项目成员通过 `GET/POST /api/v1/triage/suppressions` 查询或创建指定规则的项目抑制或 `FILE_GLOB` 抑制。`*` 和 `?` 匹配同一目录段，`**` 可以跨目录。抑制须提供到期时间和原因，`/{id}/revoke` 撤销，`/{id}/audit` 查询创建和撤销记录。操作者取当前认证账号。适用策略和人工反馈均随报告冻结，匹配版本的人工结论优先，漏洞库存由人工审核单独维护。

管理员可通过 `POST /api/v1/triage/report/pr` 将同一研判结果合并为一条 GitHub PR 评论。提交原始工具报告，请求参数沿用预览接口，另传 `owner`、`repo` 和 `prNumber`，并指定已接入项目的 `projectId`。服务端用 `REPOGRAPH_GITHUB_TOKEN` 发布，可通过 `REPOGRAPH_GITHUB_API_BASE_URL` 配置 GitHub Enterprise REST 地址。发送前检查 PR 和项目权限，评论正文使用脱敏后的报告 Markdown 和源码位置引用。成功返回 `commentUrl`、`findingsCount` 和 `reports`。若返回 `GITHUB_COMMENT_UNCONFIRMED`，评论可能已发布，可在 PR 中核实。每次请求最多尝试一次发布。[GitHub 评论接口](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment)

研判可引用报警位置及项目内各至多八个直接调用方和被调用方。索引可达性与静态安全信号同时具备时，可形成 `TRUE_RISK` 基线。SARIF 的线程路径与步骤角色随报告保留，合计最多 16 个步骤。只有每条路径都明确标注入口与终点，且同类源码防护候选出现在所有入口之后和所有终点之前，结论才回到 `NEEDS_REVIEW`。路径缺失、截断、顺序含混或只有注释中的标记时，候选不会改变结论。`decisionEvidence` 记录引用及是否应用，审核仍需确认防护运行的条件。相同逻辑用于预览、冻结审核报告和研判 Agent。[SARIF 2.1 路径规范](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html#sec-threadFlowLocation-object)

报警详情和冻结报告都可以显式请求模型复核。`POST /api/v1/triage/advisory?projectId=…` 接受报警指纹和可选的 `snapshotId`。指定 `format` 时也可提交含单条可解析报警的扫描报告进行临时复核。服务按授权项目生成或读取基础研判，响应完整保留该份报告，模型输出另列为辅助建议。请求仅发送有界的脱敏证据，模型引用必须来自实际发送的条目。缺少有效引用时只接受待人工研判的建议。停用、超时、超预算和无效响应时仍返回基础研判。服务端日志保留诊断标识、状态、用量和耗时。

研判 Agent 可接收扫描报告、已导入报警或漏洞库存记录。上传和已导入报警走 `POST /api/v1/agent-runs/sast-triage`，分别使用 `format` 及报告正文或 `{fingerprints: [...]}`。库存记录走 `POST /api/v1/agent-runs/vulnerability-triage?vulnerabilityId=…`。每项目同一时间可有一条活动研判运行，单次最多 50 条报警，模型档案在接收时固定。工作台按运行和步骤 ID 刷新台账，可取消活动运行、下载 JSON 或打开已冻结的审核报告。

步骤依次读取输入、构建上下文、生成基础研判、请求模型复核并提交人工审核。模型停用会跳过辅助步骤。个别报警或模型复核失败时，运行标记为部分完成，可用报告照常冻结。运行台账只保存进度、公开证据引用和结构化建议，冻结报告保存基础结论。审核条目与运行的快照引用同事务写入，取消活动运行保留已记录步骤。

工作台可从外部报警提交人工审核。`POST /api/v1/review-queue/snapshots?projectId=…` 接受 `{fingerprints: [...]}`，指定 `format` 时也可直接提交外部扫描报告。快照记录适用的工具、代码和规则版本，并冻结原有证据。`/review-queue` 支持按状态、严重度、结论、规则和更新时间分页筛选。`/{entryId}/{claim,return,confirm,reject}` 以当前状态和可选 `revision` 做条件迁移，冲突返回 409。退回、确认和驳回要求填写理由。`/{entryId}/audit` 记录服务端认证的操作者及时间。

`/review-queue/snapshots/{id}/review` 展示冻结报告和当前审核状态，`/export?format=json|markdown|pdf` 从同一冻结事实生成下载。PDF 内嵌随仓库分发的 Noto Sans SC 字体及许可证。`POST /review-queue/snapshots/export-batch` 返回 ZIP，`manifest.json` 记录每份快照的导出或缺失状态。更新索引和审核状态不会修改冻结报告。

漏洞库存可从已导入报警登记 `SUSPECTED`。审核队列确认时，同一事务内创建或确认同项目、同指纹的库存记录并保存审核来源。重复确认追加来源，保留已修复及已忽略状态。已有确认记录在启动时按原审核人和时间补齐。`GET /api/v1/vulns` 及 MCP `list_vulns` 可分页并按状态和严重度过滤，`/vulns/{id}` 返回审计和审核快照，`PUT /vulns/{id}/status` 支持条件迁移。`/vulns/report/{projectId}` 汇总全量状态及严重度，其明细列出确认记录。

漏洞库存的“检查已索引源码”使用 `POST /api/v1/vulns/scan/code?projectId=…`。MCP 提供 `scan_vuln_code`。检查读取指定项目索引中的源码方法、构造器与函数，沿用旧版九条启发式规则的 ID、CWE 和严重度。命中以项目、规则和代码单元去重，写入 `SUSPECTED` 及当前操作者的审计事件。扫描记录保留相对路径和行号范围，人工已处置的记录在重复扫描时继续有效。对旧库迁移后项目 ID 变化的记录，按同项目、同路径、同限定名和同规则识别既有结果。

每批最多检查 20,000 个单元和 32 MiB 索引源码，最多登记 1,000 项命中。返回 `scannedUnits`、`matchedFindings`、`newFindings`、`indexVersion` 和 `nextOffset`。`nextOffset` 有值时可与 `indexVersion` 一起请求下一批，索引已更新则返回 409。工作台自动检查后续批次，并刷新库存列表。启发式命中供人工复核。

漏洞库存的“追踪请求参数”使用 `POST /api/v1/vulns/scan/taint?projectId=…`，读取已索引的 Spring 映射方法。优先选择请求注解或请求类型对应的参数，其余情况下检查非框架上下文参数。候选终点按旧版规则登记为 `SUSPECTED`，并在同一事务保存脱敏的 SOURCE、PROPAGATION 和 SINK 步骤。重复运行按入口、参数和终点去重，保留人工处置。每批最多读取 80 个入口候选及登记 100 个命中，支持和源码检查相同的 `nextOffset`、`indexVersion`。超出分析预算或缺少源码时保留已有结果。

`GET /api/v1/triage/variants?projectId=…` 从同项目已确认的源码库存记录出发，按旧版六类调用特征查询索引。已有库存记录的代码单元排除。候选包括稳定指纹、种子记录、相似原因和源码位置，状态为 `SUSPECTED`，供人工复核。查询只读且仅返回位置和相似性摘要。默认返回 100 项，上限 500。分析最近的 100 条种子，每种特征最多读取 750 个候选单元，超出数量预算时返回 `X-RepoGraph-Variant-Partial: true`。每个单元最多比较前 16,000 个字符。

变更快照可冻结与新增行重叠的活动库存记录。已声明但与目标不符的版本不参与关联。冻结快照及 Markdown 保留当时的库存状态。当前库存来源包括导入报警、人工审核、索引源码规则和参数追踪，以及离线依赖公告检查。

仓库 Wiki 通过 `POST /api/v1/summaries/generate?projectId=…` 启动 `WIKI_SUMMARY`，返回 202 和 `pollVia`，可通过 `/api/v1/agent-runs/{id}` 查看进度。结构摘要复用索引中的符号、入口、跨模块调用和复杂度。Java 按包分组，其他语言按项目相对目录分组。任务最多采样 20,000 个符号和 100,000 个调用对，最多生成 200 个模块文档。超限或有待重试文件时标记部分完成。

启用生成模型后，Wiki 会为项目补充概述、模块、入口与调用链、构建与运行、安全相关面五个章节。模型输入仅包含脱敏的结构事实、相对位置和已登记的引用 ID。工作台标明模型内容及失败的阶段。成功章节按项目、结构事实、配置快照和提示词版本缓存。生成部分失败后再次提交可续跑缺失章节，索引事实或模型配置变化则重新生成。模型关闭时保留确定性摘要，外部调用失败时保存已完成章节和缺失原因。

`GET /api/v1/summaries?projectId=…` 和 `/summaries/tree?projectId=…` 读取最新一批文档。旧版本仍可通过 `/summaries/{id}` 或工作台 `?view=wiki&project=…&document=…` 打开。摘要与步骤一并持久化，移除项目时一并清理。源码引用保留生成时的路径与行号，点击链接定位当前索引中的源码。

管理员通过工作台的生成模型配置或 `/api/v1/admin/model-providers` 管理 Ollama、OpenAI、OpenAI 兼容及 Anthropic 档案。首次启动选中的 Ollama 档案默认停用。远程协议的基地址应包含供应商要求的 API 前缀，例如 `/v1`。档案的 `/models` 在草稿上发现模型，`/{id}/test` 用已保存档案发送一条固定的测试消息，`/{id}/select` 切换后续请求。配置与审计同事务。替换端点或协议前需要明确换密钥或清除密钥。旧 `/api/v1/agent-settings/llm` 可以读取当前设置、更新已选 Ollama 档案及检测 Ollama 模型。`/api/v1/capabilities/generation` 公布选中档案的名称、协议、模型 ID 和启用状态。连接和生成状态分别为 `NOT_CHECKED` 与 `NOT_VERIFIED`。

认证的 `GET /api/v1/health` 检查 SQLite 能否读取索引表，并在启用 Embedding 时检查已配置的 Ollama `/api/tags` 是否可达。组件失败返回 207 和 `status=degraded`。未启用的 Ollama 标记为 `disabled`，SQLite 可读时返回 200。

SQLite 中的密钥使用 AES-256-GCM 加密。主密钥位于数据库路径加 `-provider-key` 的权限 0600 文件，也可通过 `REPOGRAPH_PROVIDER_ENCRYPTION_KEY` 配置 32 字节的标准 Base64 密钥。迁移这个 TypeScript 数据库时需保留同一主密钥。生成请求有独立的配置快照，时间和字节上限覆盖整个响应，拒绝转址。费用字段在缺少价格或 token 计数时为 `null`。

仓库概览的代码质量面板可运行架构评审。`POST /api/v1/architecture/reviews` 返回 JSON，`GET /api/v1/architecture/reviews/stream` 发出 `phase`、通过引用校验的候选 `delta`、`result` 和 `complete`。发送给已选模型的是带引用 ID 的静态指标和相对位置。评审不发送源码正文。候选必须引用实际提交给模型的证据。模型停用、超预算或返回无效响应时，仍提供复杂度、耦合、包循环和 Git 热点等已收集指标。

### 旧版 SQLite 迁移

编译后运行 `npm run migrate:legacy -- --source /绝对路径/index.db --projects-root /允许索引的根目录 --output /新目录 --dry-run` 查看迁移计数。默认旧库为 `~/.repograph/index.db`。移除 `--dry-run` 才生成新目录中的 `index.db`，目录的父级应已存在。工具只读打开旧库，拒绝覆盖已有的输出目录，完成写入及完整性检查后才发布新库。启动服务时将 `REPOGRAPH_DB_PATH` 指向新库，项目根范围使用与迁移一致的 `REPOGRAPH_PROJECTS_ROOT`。

迁移保留账号审批状态、凭据版本、组织、成员、管理审计和可映射的项目归属。旧 BCrypt 密码首次成功登录后自动转换为 scrypt。符合工作区边界的现存本地仓库进入待索引状态，首次索引重新读取源文件。已标记删除、缺失、范围外及托管归档项目单独计数。找不到项目路径的归属和本次未迁移的记录在报告中列出。

迁移保留生成模型档案及当前选择。加密档案使用旧库同目录的 `provider-encryption-key` 验证，也可通过 `--legacy-key-file` 或 `REPOGRAPH_LEGACY_PROVIDER_ENCRYPTION_KEY` 提供旧密钥。通过验证后用 TypeScript 版主密钥重新加密，生成的 `index.db-provider-key` 需与新库配套保存。如果用 `REPOGRAPH_PROVIDER_ENCRYPTION_KEY` 写入，新服务沿用该环境变量。迁移过程没有外部请求。

旧库中的 Maven 公告记录会迁移到新库，保留旧导入来源与版本区间。可映射项目的旧漏洞记录保留 ID、最后保存的状态和发现时间。新库记录一次迁移审计，之后沿用库存的状态迁移和审计。依赖记录按目标项目重新计算匹配指纹，即使项目 ID 因路径规范化改变，重新检查也能关联原记录。旧记录缺失的修复区间和处置历史保持缺失。

历史漏洞详情和 `GET /api/v1/vulns/{id}/taint-evidence` 按原顺序展示保存的证据。源片段遮盖常见凭据，敏感路径的片段整体遮盖。非项目相对路径不生成源码链接。迁移报告列出因项目无法映射而跳过的漏洞和证据数量。

可映射项目的旧外部报警、审核快照、队列条目和审核事件随新库导入。旧报警保留指纹、工具运行 ID 和首次及最近发现时间。快照保留 ID、版本、原结论、引用和决策证据，排除原始工具正文并对片段脱敏。历史操作保留 ID、操作人、理由和时间，转换为当前动作枚举。待审核条目可以继续处置，已有确认在关联唯一报告时保留库存链接。若有多份同指纹报告，导出保留全部报告，工作台显示匹配数量并收起决策操作。

工作台的扫描历史按项目读取旧版任务和工具运行。可映射项目的记录保留任务、资产、运行和已知原批次 ID。重试复用的运行仍归属原批次。迁移时仍在排队或运行的任务标记为进程中断，已保存的报警仍可按任务分页读取。历史详情仅保存脱敏后的归一化报警，外部报警可链接同一项目中存在的运行。迁移报告分别统计独立运行、仅在任务中保存的运行以及无法映射的记录。

只读接口包括项目列表查询 `GET /api/v1/scan-tasks?projectId=…` 和 `GET /api/v1/scans?projectId=…`，原 ID 详情 `/scan-tasks/{id}`、`/scan-tasks/{id}/findings` 和 `/scans/{id}`，以及归档资产历史 `/assets/{id}/scans`。项目列表及任务报警按零基页码分页。

人工研判反馈、规则抑制及其创建和撤销审计跟随项目映射，记录的理由经过脱敏。抑制保留活动标记和到期时间，由研判时钟判断是否生效。迁移报告列出无法映射的记录与被跳过的路径范围。

旧版 Agent 运行、步骤及公开引用跟随项目映射，保留原 ID、顺序、终态和可公开的辅助建议。原进程中断的运行标记为部分完成或失败，保留已记录步骤。迁移后的 SAST 台账可通过原运行 ID 查询和导出，并可打开同项目中已迁移的审核快照。引用的报告未迁移时保留引用并标记不可用。迁移计数分别列出运行、步骤、引用和建议。

变更评审快照保留原 ID、版本、生成时间、分组账本和冻结证据。没有分组账本的早期记录，只根据能唯一对应的文件与 diff 片段补齐分组。旧报警指纹和漏洞 ID 随快照保留。迁移过程重新脱敏，敏感文件重命名前后的片段均遮盖。工作台、JSON、Markdown 和历史 Agent 运行通过同一快照读取证据。

Wiki 文档保留原 ID、历史版本、章节来源与有效的相对路径引用。`GET /api/v1/summaries/{id}/export` 导出所选文档的 Markdown。首次重新生成前，目录显示旧版每个范围的最新文档。重新生成从该范围已有的最高版本继续，历史版本仍可按原 ID 读取。旧版生成缓存会计入跳过项，新缓存按 TypeScript 版事实指纹和模型配置生成。

检测规则迁移保留版本、活动状态、正负样本及生命周期审计。旧评估快照跟随项目映射。`/api/v1/rules` 查询版本和审计，管理员可创建候选、送审、发布、驳回和回滚。发布仅在登记样本上校验匹配，正则采用 Node.js 的 DOTALL 语义并在限时 worker 中运行。生效版本和审计同事务写入，操作者取当前认证账号。

`src/rule-export.ts` 的 `toSemgrepYaml` 和 `toSourceSinkJson` 从同一条规则记录生成确定性文本。两种格式都保留规则 ID、版本、严重度映射、语言、框架、CWE 和来源。Semgrep 子串使用 PCRE2 字面引用，正则保留原文并启用 DOTALL、关闭 MULTILINE。迁移的旧正则保留 Java 引擎标识，新规则使用 ECMAScript。source-sink JSON 保存一个 matcher 及空的 `sources`。目标正则方言差异仍需用实际工具对子集验证。[Semgrep 规则语法](https://docs.semgrep.dev/writing-rules/rule-syntax#pattern-regex)

`GET /api/v1/rules/{id}/evaluation?projectId=…` 按规则 ID 汇总现有审核快照并按报警指纹去重，记录评估时选中的登记版本。只有与对应快照的代码和规则版本一致的反馈才计入确认或误报。缺少分母时比率为 null。结果保存为评估快照，`/evaluations` 可读取历史和指标变化。

旧归档默认从 `~/.repograph/assets` 读取，可通过 `--legacy-assets-root` 指定旧服务的存放目录。迁移校验登记路径、文件类型、大小和目录深度，拒绝链接及非普通文件。可迁移的源码作为独立副本写入新库旁的 `index.db-assets`，发布数据库前重建源码索引。资产 ID 和创建时间保留，项目 ID 按新路径计算，已支持迁移的归属和历史记录会跟随新项目。报告分别列出跳过原因与重建结果。启动新库时使用该新归档目录，或让服务按数据库路径推导默认目录。删除迁移后的资产只清理新副本。

旧源码图谱、向量、增量指纹及其他分析产物仍保留于原存储。

`npm run check` 验证 TypeScript 类型。`npm test` 编译并运行解析、HTTP/stdio 联调、账号权限、归档与依赖清单、图谱和质量报告、外部报警研判、变更评审、Wiki、生成及向量协议替身测试，并验证旧版身份、配置、归档和历史审查数据的迁移。真实 Embedding 和扫描器的验收范围见各自章节。生成供应商协议与 GitHub PR 评论发送由本地 HTTP 替身测试覆盖。

设置 `REPOGRAPH_TEST_SEMGREP_BINARY` 为本地 Semgrep 可执行文件并运行 `npm test`，可验证导出的子串和正则规则在真实工具中均只命中正样本。未设置时跳过该工具集成检查。

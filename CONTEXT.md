# RepoGraph — Project Context

> 本文件描述项目架构、领域模型和当前运行状态，供 LLM 理解代码背景使用。
> 行为规范见 AGENTS.md。

## 项目定位

**终极方向**：让 LLM 以 Agent 身份在大型代码库中按需定位上下文——MCP 工具集 + GraphRAG 检索是核心交付物。

**当前阶段**：作为独立代码审计平台，在平台上完成所有能力的开发与验证，后续再做迁移。
待开发阶段目标：`search_graphrag` 暴露为 MCP 工具；工具结果加 `rawSource` 字段。

本地代码知识图谱，面向静态启发式代码分析。**不做完整编译器语义分析**，粗中粒度够用，支撑：
- 语义检索（NL → 代码）与代码相似检索
- 调用链 / 影响面分析（GraphRAG）
- 跨过程污点分析与漏洞管理
- 代码质量指标（圈复杂度、耦合、包循环、热点）
- SBOM 提取（Maven / Gradle / npm / pip）

**技术栈**：Java 22+，Spring Boot 3.x，Gradle（Kotlin DSL）；Web UI：Thymeleaf + HTMX + Alpine.js。
解析目标：Java / C / Python 源码 + Markdown 文档 + Java 字节码（可选）。

## 模块结构

两个可独立部署的 JAR，源码均在对应 Gradle 子项目下：

```
repograph-app/   Spring Boot 服务 + Picocli CLI
  com.repograph.core/        领域模型 + 接口定义
    model/        CodeUnit / CodeUnitKind / RelationEdge / EdgeKind
    parser/       CodeParser / ParseResult / ParseStrategy / ParseOptions
    graph/        GraphQueryService / GraphDiagnosticsService / ProjectInfo / ProjectStats
    vector/       VectorStore / EmbeddingService / SearchResult / SearchOptions
    flow/         FlowAnalysisService / TaintAnalysisService / TaintSummaryService + 所有流图模型
    pipeline/     IndexPipeline / IndexStore / IndexOptions / IndexProgressEvent
    retrieval/    GraphRagOptions / GraphRagResult / RankedUnit
    util/         ProjectIdUtil / PathUtil / CodeUnitIdUtil

  com.repograph.parser/
    java/         JavaParser AST 精确解析
    treesitter/   Tree-sitter FFM 封装（C / Python）
    heuristic/    启发式状态机（精确解析失败时降级）
    doc/          MarkdownDocParser（.md/.markdown → DOCUMENT CodeUnit）

  com.repograph.graph/       Neo4j 代码图门面（Bolt 5.x）
  com.repograph.vector/      QdrantVectorStore（gRPC）+ OllamaEmbeddingService（HTTP）
  com.repograph.flow/        JavaFlowAnalysisService / TreeSitterFlowAnalysisService
                             JavaTaintAnalysisService / JavaFlowTaintSummarizer
  com.repograph.retrieval/   GraphRagService + SecurityAwareReranker
  com.repograph.framework/   Spring / JAX-RS / MyBatis 注解识别，标记 is_entry_point
  com.repograph.sbom/        DispatchSbomService → Maven / Gradle / npm / pip → CycloneDX JSON
  com.repograph.vuln/        漏洞管理
    CodeVulnScanner           方法内静态规则扫描（9 条 CWE 规则）
    TaintVulnScanner          跨过程污点追踪（HTTP 入口 → Sink）
    DepsVulnScanner           依赖 CVE 扫描（基于 SBOM + 离线 Advisory）
    AdvisoryStore             离线 CVE 数据库（JSON → SQLite 幂等 seed）
    VulnStore                 发现记录持久化 + 状态机
    VulnFinding / VulnReport  领域模型
  com.repograph.metrics/     代码质量分析
    ComplexityAnalyzer        圈复杂度（CC，基于 rawSource 启发式）
    CouplingAnalyzer          不稳定度（I = fan-out / (fan-in + fan-out)）
    PackageCycleDetector      Tarjan SCC 检测包循环依赖
    GitChurnAnalyzer          git log 变更频率
    HealthReportService       聚合六维度生成健康分（100 起扣分制）
  com.repograph.export/      GraphExportService（包级依赖图 → DOT / Mermaid）
  com.repograph.api/         Spring MVC REST 控制器
  com.repograph.app/         Picocli CLI + 索引管道（DefaultIndexPipeline）+ Spring Boot 入口

repograph-mcp/   独立 MCP stdio 服务（JSON-RPC，供 AI 工具调用，通过 HTTP 转发至 repograph-app）
```

## 核心领域模型

**CodeUnitKind**：`CLASS | INTERFACE | ENUM | ANNOTATION | METHOD | CONSTRUCTOR | FIELD | LOCAL_VAR | STRUCT | UNION | TYPEDEF | MACRO | FUNCTION | DOCUMENT`
- `FUNCTION`：C 顶层函数（无所属类）；`STRUCT/UNION/TYPEDEF/MACRO` 仅 C 使用
- `DOCUMENT`：Markdown 文件中按 H1-H3 标题切分的章节，由 `MarkdownDocParser` 生成，支持语义检索

**metadata 标准 key**：

| key | 取值 |
|-----|------|
| `framework` | `"spring"` \| `"jaxrs"` \| `"mybatis"` |
| `visibility` | `"public"` \| `"private"` \| `"protected"` \| `"package"` \| `"file-local"` |
| `is_static` / `is_final` / `is_abstract` | `"true"` |
| `is_record` | `"true"`（Java record） |
| `is_declaration` | `"true"`（C 函数声明，非定义） |
| `is_entry_point` | `"true"`（框架注解入口或 C 入口启发式） |
| `is_test` | `"true"`（@Test 或 *Test.java） |
| `is_builtin` | `"true"`（libc/Linux kernel 符号，不建 CALLS 边） |
| `return_type` | 返回类型字符串 |
| `param_types` | 逗号分隔，如 `"String,int"` |
| `ann_<AnnotationName>` | 注解的主要属性值，如 `ann_RequestMapping="/api/users"`；仅 `value` / `path` 属性 |

**EdgeKind**：`CONTAINS | CALLS | IMPORTS | EXTENDS | IMPLEMENTS | DEFINES_TYPE | OVERRIDES`

> EXTENDS（继承）和 IMPLEMENTS（接口实现）**必须分开存储**。

## 解析策略

| 策略 | 行为 |
|------|------|
| `PRECISE` | 直接用精确解析器（JavaParser / Tree-sitter） |
| `HEURISTIC` | 直接用启发式状态机 |
| `AUTO`（默认） | 先精确，失败/空结果则降级启发式 |

Java 方法调用优先使用接收者类型、方法名和可静态推断的实参类型绑定重载；
当前支持字面量、显式类型转换、对象创建以及参数/局部变量/字段的声明类型。
同文件内支持通过方法返回类型解析链式调用，并沿已声明的 EXTENDS 层次解析继承方法；
显式静态导入和唯一来源的静态通配导入会转换为统一的 `Type#method(params)` 目标。
跨文件调用无法获得完整类型时保留参数数量，图写入阶段只在同一 `projectId`
内得到唯一候选时建立 CALLS 边；同参数数量仍有多个重载时保持未解析，避免误连。

## 索引管道（顺序不可打乱）

```
1. 扫描文件
   .java→java / .c .h→c / .py→python / .md .markdown→doc / .class→class（显式开启）
2. 增量过滤（SQLite MD5 缓存，~/.repograph/index.db）
3. 并行解析（ForkJoinPool，strategy=AUTO）→ CodeUnit + RelationEdge
   doc 文件由 MarkdownDocParser 生成 DOCUMENT 类型 CodeUnit
4. 元数据增强（framework / is_entry_point / is_test）
5. 图构建（addUnits + addEdges 批量 UNWIND 写入 Neo4j）
6. 批量 Embedding（批大小 8，并行度 4）
   semantic_vec = embed(signature + annotations)
   code_vec     = embed(rawSource)
   DOCUMENT CodeUnit：semantic_vec = embed(章节文本)，code_vec = embed(章节文本)（同源）
7. 批量写入 Qdrant（批大小 256）
8. 更新 SQLite MD5 缓存
```

> 索引为**异步**：`POST /api/v1/index/project` 返回 202，用 `GET /api/v1/index/project/status` 轮询。

## 当前服务配置（实际运行值）

`repograph-app/src/main/resources/application.yml`：

```yaml
repograph:
  qdrant:
    host: localhost
    port: 16334          # Docker: host:16334 → container:6334 (gRPC)
    collection: code_units
    vector-size: 3584    # manutic/nomic-embed-code 输出维度
  ollama:
    base-url: http://192.168.4.113:11434
    model: manutic/nomic-embed-code
    timeout-seconds: 300  # 7.5GB 模型每批耗时较长
  neo4j:
    uri: bolt://localhost:7687
    user: neo4j
    password: neo4jneo4j
  index:
    batch-size:
      embed: 8            # 大模型减小批次避免超时
      upsert: 256
    default-strategy: AUTO
```

Qdrant 容器需暴露两个端口：`-p 16333:6333 -p 16334:6334`（16333 是 HTTP REST，16334 是 gRPC）。

Neo4j Docker 启动示例：`-p 7474:7474 -p 7687:7687`（7474 浏览器 UI，7687 Bolt 协议）。

## 向量存储

- **双向量**：每个 CodeUnit 存 `semantic`（签名+注解）和 `code`（rawSource）两个向量
- **Filter 维度**：`kind / language / project_id`（精确匹配）；`metadata.is_entry_point / metadata.is_test`（布尔）

## 图存储

- **后端**：Neo4j 5.x（外部服务，Bolt 协议）
- **Schema**：节点统一打 `:CodeUnit` 标签，标准字段为顶层属性，`metadata` 扁平化（如 `is_entry_point: "true"`）
- **关系类型**：直接使用 `EdgeKind` 枚举名（`:CALLS`、`:EXTENDS` 等）
- **索引**：启动时幂等创建 `id` 唯一约束 + `qualifiedName / projectId / filePath / is_entry_point` 二级索引
- **查询接口**：
  - `GraphQueryService`：结构化图遍历（callers / callees / impact / subtypes）
  - `GraphDiagnosticsService`：批量诊断扫描（漏洞扫描目标提取、跨类调用边、死代码检测、测试空白检测）
- **查询**：全部走 Cypher，变长深度用 `[:CALLS*1..N]`；无应用端缓存层
- **符号解析**：图查询支持按部分名称查找完整 `qualifiedName` 候选；Java 方法候选包含参数列表
- **项目隔离**：callers / callees / impact / subtypes 均可按 `projectId` 限定，避免多仓库同名符号串扰
- **持久化**：Neo4j 自身管理，无 JSON 快照或启动加载

## 流分析

### 函数内（Intra-procedural）
- **方法级数据流摘要**：参数、实例字段读写、返回值来源。
- **按需 CFG**：针对单个方法/构造器临时生成 ENTRY、EXIT、语句、条件、返回和异常节点。
- **轻量 PDG**：复用 CFG 节点，组合数据依赖与控制依赖；不将语句节点持久化为 `CodeUnit`。
- **当前覆盖**：
  - Java（`JavaFlowAnalysisService`）：JavaParser 精确 AST，`precise=true`；支持顺序、if/else、
    for/foreach/while/do-while、break/continue/return/throw；CFG + 轻量 PDG；污点摘要可用。
  - C / Python（`TreeSitterFlowAnalysisService`）：Tree-sitter AST，`precise=false`；
    仅 CFG + 保守 DataFlowSummary（参数提取、return 标识符收集）；不生成 PDG；
    C 支持 if/for/while/do-while/switch/return/break/continue；
    Python 支持 if/elif/else/for/while/try/raise/break/continue。
- **精度边界**：Java 数据依赖为保守启发式，不构建 SSA；C/Python 因缺乏类型信息，
  DataFlowSummary 为启发式近似，fieldReads/fieldWrites 为空；
  异常边为 try 体首节点到各 catch 的保守近似，不建模每条语句的精确抛出点。
- **查询入口**：`GET /api/v1/flow/analyze?target=<qualifiedName>&projectId=<id>`。

### 跨过程污点分析（Inter-procedural Taint）
- **算法**：Flow-insensitive 方法内摘要 + BFS 沿调用图传播。
- **方法内摘要**（`MethodTaintSummary`）：固定点迭代赋值语句，计算 `param[i] → return`、
  `param[i] → callee.arg[j]`、`param[i] → SINK` 三类 `TaintEdge`。
- **跨过程 BFS**（`JavaTaintAnalysisService`）：从污点源方法出发，沿 `CALL_ARG` 边进入被调用方，
  Callee 通过 Neo4j CALLS 边 + 简单名匹配解析；环路用 visited 集合剪枝。
- **Sink 检测**：内置 SQL（executeQuery/executeUpdate）、OS（exec/start）、反序列化（readObject）、
  HTTP 输出（write/println）、反射（invoke）、JNDI（lookup）等常见危险方法名。
- **精度**：Flow-insensitive 保守近似（宁多报不漏报）；Callee 按简单名匹配，多重载时全部展开。
- **查询入口**：`GET /api/v1/flow/taint?source=<qualifiedName>&paramIndex=0&projectId=<id>&maxDepth=6`。
- **输出**：`TaintResult` 包含 `TaintPath` 列表，每条路径记录跳链（`TaintHop`）和是否命中 Sink。

## GraphRAG 检索

- **向量种子**：通过 `VectorStore.semanticSearch` 获取候选，并沿用语言、项目和测试代码过滤。
- **调用图扩展**：按配置沿 callers / callees 展开，结果按 qualifiedName 去重。
- **影响面扩展**：对前若干种子执行 `impactAnalysis`，仅补充安全启发式命中的节点。
- **安全重排序**：基于入口点、认证授权、SQL、命令执行、反序列化和加密等静态信号加权。
- **边界**：影响面扩展不是函数内数据流分析；CFG / PDG 仍通过 `FlowAnalysisService` 按需查询。
- **查询入口**：`GET /api/v1/search/graphrag?impactExpansion=true`；
  旧参数 `dataFlow` 暂时保留兼容。

## projectId 与 filePath 规范

- `projectId`：`SHA256(projectRoot.toAbsolutePath().normalize().toString())[:12]`（12 字符前缀）
- `filePath`：相对 projectRoot 的路径，统一 `/` 分隔，不存绝对路径

## 漏洞管理

三条互补扫描路径，均写入同一 `VulnStore`（SQLite）：

| 扫描器 | 原理 | 速度 | 适用 |
|--------|------|------|------|
| `CodeVulnScanner` | 方法内字符串规则（9 条 CWE 规则） | 快（秒级） | 快速普查，有误报 |
| `TaintVulnScanner` | 跨过程污点追踪（HTTP 入口 → Sink） | 慢（数十秒） | 精确多跳污点链 |
| `DepsVulnScanner` | SBOM × 离线 CVE Advisory | 快 | 依赖 CVE |

**状态机**：`SUSPECTED → CONFIRMED → FIXED / DISMISSED`，`CONFIRMED` 后才计入报告。

**HealthReportService 健康分扣分规则**（起始 100，下限 0）：
- CRITICAL/HIGH/MEDIUM/LOW 漏洞（活跃）× 15/10/5/2
- 包循环 × 10（上限 −30）
- CC > 10 方法 × 2（上限 −20）
- 高不稳定类（I > 0.8）× 1（上限 −10）
- 测试空白率 > 70%/50%/30%：−15/−10/−5
- 死代码率 > 10%：−5

## 代码质量指标

`com.repograph.metrics` 提供四类启发式分析，全部基于 `GraphDiagnosticsService` 批量查询结果：

- **圈复杂度（CC）**：基于 rawSource 关键字计数，非 AST 精确值
- **不稳定度（I）**：`fan-out / (fan-in + fan-out)`，通过跨类调用边统计
- **包循环**：Tarjan SCC，环中节点数 ≥ 2 即记录
- **Git Churn**：调用 `git log --format=... --name-only` 统计文件变更频率

导出：`GraphExportService` 将包级依赖图输出为 DOT（Graphviz）或 Mermaid 格式；循环依赖包在 DOT 中红色高亮。

## 架构决策记录

| 决策 | 选择 | 原因 |
|------|------|------|
| 向量库 | Qdrant | 官方 Java SDK，gRPC，filter 能力强 |
| C/Python 解析 | Tree-sitter FFM | 容错强，无 JNI 复杂度 |
| Markdown 索引 | DOCUMENT CodeUnitKind | 让文档内容参与语义检索，复用现有 embed/store 管道 |
| Embedding | 双向量 | 两种检索策略 embed 输入不同，共用损失精度 |
| 增量存储 | SQLite MD5 | 无额外服务依赖 |
| 图存储 | Neo4j 5.x（Bolt）| 原生图遍历（Cypher 变长路径），跨进程共享，免应用层 BFS 与 JSON 快照 |
| 行号 | 1-based | 与编辑器对齐 |
| 索引 API | 异步（202）| Embedding 大模型耗时数十分钟，同步会超时 |
| 函数内流图 | 按需生成，不持久化语句节点 | 避免 Neo4j 图规模膨胀，同时支持局部 CFG/PDG 分析 |
| Advisory 数据库 | 离线 JSON 打包至 classpath + SQLite 持久化 | 完全离线，无需外部请求；启动时幂等 seed，可追加导入 |
| 漏洞扫描分层 | CodeVuln（快）+ TaintVuln（精）+ DepsVuln（依赖）| 各层互补，不强制串行 |
| 质量指标 | 启发式 rawSource 统计 | 无需完整 AST，对大代码库仍有可接受精度 |

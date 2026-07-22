<div align="right">

[English](README.en.md)

</div>

<div align="center">
  <img src="repograph-app/src/main/resources/static/img/logo.png" alt="RepoGraph" width="200"/>
</div>

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Java 25](https://img.shields.io/badge/Java-25-blue.svg)](https://openjdk.org/)

</div>

# RepoGraph

本地代码知识图谱与语义分析工具，面向静态启发式代码分析。

- **语义检索**：用自然语言描述查找代码，Markdown 文档同样参与检索
- **代码相似检索**：通过代码片段找到相似实现
- **调用链分析**：查询调用者、被调用者与影响面
- **继承图分析**：查找子类与接口实现
- **污点分析**：源码级跨过程污点追踪 + WALA IFDS 字节码级精确污点（独立引擎）
- **漏洞管理**：代码规则 / 依赖 CVE / 污点扫描三路互补，状态机管理发现记录
- **代码质量**：圈复杂度、耦合、包循环、Git 热点与健康报告
- **SBOM 提取**：自动识别 Maven / Gradle / npm / pip，生成 CycloneDX JSON

**技术栈**：Java 25（app）+ Java 21（精确污点引擎），Spring Boot 3.x，Gradle（Kotlin DSL）  
**解析目标**：Java / C / Python 源码 + Markdown 文档 + Java 字节码（可选）  
**存储后端**：[Qdrant](https://qdrant.tech/)（向量）、[Neo4j](https://neo4j.com/)（图）、[Ollama](https://ollama.ai/)（Embedding）、SQLite（增量缓存）

---

## 项目定位

RepoGraph 的终极方向是成为 **LLM Agent 的上下文提供者**：让 Agent 在大型代码库中以工具调用方式按需定位上下文，而不是把整个仓库塞进上下文窗口。MCP 工具集 + GraphRAG 检索是核心交付物。

当前阶段以**独立代码审计平台**形态交付——所有分析能力先在平台上（Web 控制台 / REST / CLI）完成开发与验证，再逐步暴露为 MCP 工具（进度见[开发计划](#开发计划)）。

**能力边界**：面向静态启发式分析，不做完整编译器语义分析——粗中粒度对检索与审计够用；需要最高精度的场景由 WALA IFDS 精确污点引擎补位。完全本地运行，代码不出内网。

---

## 项目能力

| 能力域 | 能力 | 说明 | 使用入口 |
| --- | --- | --- | --- |
| 代码解析 | Java | AST 解析，提取类型、方法、字段、注解与调用边 | `repograph index` / 索引页面 |
| 代码解析 | C / Python | Tree-sitter 解析；失败时自动降级 | `repograph index` / 索引页面 |
| 代码解析 | 字节码 | 可选 `.class` 分析 | 索引时指定 `class` 语言 |
| 代码解析 | Markdown 文档 | 按 H1-H3 标题切分为 DOCUMENT 单元，参与语义检索 | 索引管道自动识别 `.md` |
| 索引 | 增量索引 | 文件级缓存，仅处理变更文件 | `repograph index` / `POST /api/v1/index/project` |
| 索引 | 文件监听 | 监听增删改，自动触发增量更新 | `repograph watch` / 项目概览 |
| 索引 | 多项目管理 | 稳定 ID、隔离存储与统计管理 | 顶部项目选择器 / `repograph projects` |
| 向量检索 | 语义搜索 | 自然语言 → 代码单元 | 搜索页面 / `search_semantic` |
| 向量检索 | 代码相似搜索 | 代码片段 → 相似实现 | 搜索页面 / `search_code` |
| GraphRAG | Hybrid 种子召回 | 向量种子 + 关键词种子（函数名 / CVE / CWE / 规则 ID / 配置 key） | `GET /api/v1/search/graphrag` |
| GraphRAG | 关键词检索 | qualifiedName / signature / rawSource 轻量 BM25-like 检索 | `GET /api/v1/search/keyword` |
| GraphRAG | 调用图展开 | 种子 → callers + callees 展开 | `GET /api/v1/search/graphrag` |
| GraphRAG | 影响面扩展 | 影响面展开，仅补充安全相关节点 | `GET /api/v1/search/graphrag?impactExpansion=true` |
| GraphRAG | 安全感知重排序 | 静态安全信号评分，无需 LLM | `GET /api/v1/search/graphrag?rerank=true` |
| 符号查询 | 符号详情与定位 | 按限定名查询，或按文件行号定位 | 符号页面 / CLI / REST |
| 符号查询 | 符号自动补全 | 部分名称匹配，返回完整符号候选 | 图谱页面目标符号输入框 |
| 代码图 | 调用链分析 | 基于接收者类型与继承关系的精确调用解析 | 图谱页面 / CLI / MCP |
| 代码图 | 影响面分析 | 跨调用、继承和覆盖关系的传递影响分析 | 图谱页面 / `repograph impact` |
| 代码图 | 类型层次 | 子类与接口实现分类查询 | 图谱页面 / `repograph subtypes` |
| 代码图 | 项目隔离 | 所有图查询支持 `projectId` 过滤 | 顶部项目选择器 / REST |
| 流分析 | 数据流摘要 | 参数、字段读写与返回值摘要 | 图谱 → 流分析 |
| 流分析 | CFG | Java 方法与构造器的控制流图 | 图谱 → 流分析 → CFG |
| 流分析 | PDG | 数据依赖与控制依赖的组合分析 | 图谱 → 流分析 → PDG |
| 流分析 | 跨过程污点 | 方法内摘要 + BFS 沿调用图传播，内置 SQL/OS/反序列化等 Sink | `GET /api/v1/flow/taint` |
| 框架分析 | 入口点识别 | Spring MVC、JAX-RS、MyBatis 注解识别与标记 | 图谱入口点 / 项目工具 |
| 漏洞 | 代码扫描 | 9 条 CWE 标注静态规则 | `repograph vuln scan-code` / 漏洞面板 |
| 漏洞 | 污点扫描 | 跨过程污点追踪（HTTP 入口 → Sink，源码级启发式） | `POST /api/v1/vulns/scan/taint` |
| 漏洞 | 精确污点扫描 | WALA IFDS 字节码级 field-sensitive（独立进程引擎） | `POST /api/v1/vulns/scan/taint/precise` |
| 漏洞 | 依赖 CVE | 离线 Advisory 数据库 × SBOM 比对 | `repograph vuln scan-deps` / 漏洞面板 |
| 质量指标 | 复杂度 / 耦合 / 包循环 / 热点 | 圈复杂度、不稳定度、Tarjan SCC 包循环、Git Churn | `repograph complexity` 等 / `GET /api/v1/metrics/*` |
| 质量指标 | 健康报告 | 漏洞、循环、复杂度等六维度扣分制健康分 | `GET /api/v1/metrics/report` / `get_health_report` |
| 可视化 | 依赖图导出 | 包级依赖图 → DOT / Mermaid，循环依赖高亮 | `repograph export` / `GET /api/v1/export/graph` |
| SBOM | Maven | `pom.xml` → CycloneDX JSON（`pkg:maven`） | `repograph sbom` / 项目工具 |
| SBOM | Gradle | `build.gradle[.kts]` + `libs.versions.toml` → CycloneDX JSON（`pkg:maven`） | `repograph sbom` / 项目工具 |
| SBOM | npm | `package.json` → CycloneDX JSON（`pkg:npm`），支持 scoped 包 | `repograph sbom` / 项目工具 |
| SBOM | pip | `pyproject.toml` + `requirements*.txt` → CycloneDX JSON（`pkg:pypi`） | `repograph sbom` / 项目工具 |
| 可视化 | Web 控制台 | 搜索、代码图、流分析、统计、索引与健康状态 | `http://localhost:8080` |
| AI 集成 | MCP stdio 服务 | 23 个 MCP 工具：搜索 / GraphRAG / Context Pack / SAST 研判 / 反馈闭环 / 调用链 / 污点 / 漏洞 / 索引管理 | `repograph-mcp` |
| 质量评测 | 检索 Benchmark | Hit@1/3/5/10、MRR@10、HitScore 及阈值门禁 | Benchmark 页面 / Gradle 测试 |
| 容错 | 解析降级 | 解析失败自动降级，不阻断整体流程 | 索引管道 |

> 流分析：Java 支持 CFG + PDG + 污点摘要（精确 AST）；C / Python 仅 CFG + 保守数据流摘要。数据依赖为保守启发式估算，不构建 SSA。

---

## 界面截图

**语义搜索** — 用自然语言在整个代码库中检索代码单元

![语义搜索](docs/screenshots/01-semantic-search.png)

**代码图谱** — 调用链、影响面分析、死代码与类型层次

![代码图谱 – 调用者](docs/screenshots/02-graph-callers.png)

**流分析** — 按需生成 Java 方法级 CFG 与 PDG

![流分析 – CFG](docs/screenshots/05-flow-cfg.png)

**漏洞面板** — 代码扫描、依赖 CVE 与影响链分析

![漏洞面板](docs/screenshots/07-vuln-panel.png)

---

## 核心优势

**完全本地，数据零上云**  
解析、向量化、检索均在本机完成，代码不经过任何外部 API。适合私有代码库与隔离内网环境。

**GraphRAG：向量检索 × 图遍历 × 安全感知重排序**  
向量检索找到候选种子，调用图展开邻近节点，安全感知重排序对高风险模式打分——三阶段合并为一次 API 调用，全程无需 LLM。

**结构化 Chunk，语义文本三层叠加**  
每个方法的向量输入包含三层上下文：类级 Javadoc + 注解、方法 Javadoc、方法签名。三层叠加让自然语言查询可命中私有/包级方法。双向量存储（语义 + 代码相似）互不干扰。

**三语言 × 三策略解析，容错降级**  
支持 Java、C、Python，精确 / 启发式 / 自动三策略。单文件解析失败自动降级，不阻断整体流程。

**增量索引，改一个文件只重建一个文件**  
文件级 MD5 缓存，重索引只处理变更文件。百万行代码库增量更新可在秒级完成。

**框架感知，自动识别入口点**  
识别 Spring MVC、JAX-RS、MyBatis 注解，自动标记入口点。无需手工标注，可直接查询所有端点或 DAO 方法。

**本地漏洞管理，规则 + 污点 + 依赖三路互补**  
9 条 CWE 标注静态规则、跨过程污点追踪（源码级 + WALA IFDS 字节码级精确引擎）、离线 CVE 数据库（80 条，覆盖主流 Java 依赖）。发现记录走状态机确认流程，结合图遍历输出调用链影响面。完全离线，无需外部扫描服务。

**多生态 SBOM，一条命令生成**  
自动识别 Maven、Gradle、npm、pip，输出 CycloneDX JSON，直接衔接依赖漏洞扫描。

**MCP 原生集成，直接接入 AI 工具**  
独立 MCP stdio 服务（`repograph-mcp`），Cursor 等支持 MCP 协议的 AI 工具直接调用，无需中间层。

---

## 模块结构

三个 Gradle 子项目：

```
repograph-app/   Spring Boot 服务 + Picocli CLI（REST API、索引管道、检索）
  ├─ core/        领域模型 + 接口定义（CodeUnit / VectorStore / GraphQueryService）
  ├─ parser/      JavaParser AST、Tree-sitter FFM（C/Python）、Markdown 文档、启发式状态机
  ├─ graph/       Neo4j Bolt 门面（调用链 / 影响面 / 继承图）
  ├─ vector/      Qdrant gRPC（向量存储）+ Ollama（Embedding）
  ├─ flow/        函数内 CFG / PDG / 数据流摘要 + 跨过程污点分析
  ├─ retrieval/   GraphRAG 检索 + 关键词召回 + 安全感知重排序 + Context Pack 上下文组装
  ├─ framework/   Spring / JAX-RS / MyBatis 注解识别，标记入口点
  ├─ sbom/        Maven / Gradle / npm / pip → CycloneDX JSON
  ├─ vuln/        漏洞扫描（代码规则 / 污点 / 依赖 CVE）+ 发现记录状态机
  ├─ metrics/     圈复杂度 / 耦合 / 包循环 / Git 热点 / 健康报告
  ├─ export/      包级依赖图导出（DOT / Mermaid）
  ├─ api/         Spring MVC REST 控制器
  └─ app/         Picocli CLI + 索引管道 + Spring Boot 入口

repograph-mcp/   独立 MCP stdio 服务（供 AI 工具调用，通过 HTTP 转发至 repograph-app）

repograph-taint-engine/   WALA IFDS 精确污点引擎（试验性模块，独立进程，JDK 21 运行）
  字节码级 field-sensitive 污点分析；app 以子进程调用其 TaintScanCli（JSON I/O），
  支撑 /api/v1/vulns/scan/taint/precise 精确扫描；详见模块内 README
```

---

## 前置依赖

| 服务 | 启动方式 |
|------|----------|
| **Qdrant** | `docker run -d -p 16333:6333 -p 16334:6334 qdrant/qdrant` |
| **Neo4j** | `docker run -d -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/neo4jneo4j neo4j:5` |
| **Ollama** | 本机或远端启动，拉取模型 `ollama pull manutic/nomic-embed-code` |
| **JDK 25** | 需开启 `--enable-native-access=ALL-UNNAMED`（Tree-sitter FFM）；精确污点扫描另需一个带 jmods 的 JDK（如 JDK 21） |

---

## 构建

```bash
./gradlew build -x test   # 跳过测试快速构建
./gradlew test            # 运行全部测试（单元 + 集成）
```

**检索效果 Benchmark**（需先建索引，Qdrant + Ollama 在线）：

```bash
# 对 repograph-app 自身建索引后运行 benchmark（23 条语义 + 8 条代码相似查询）
repograph index ./repograph-app
./gradlew :repograph-app:test --tests "*.benchmark.*"

# 对外部项目 benchmark
./gradlew :repograph-app:test --tests "*.benchmark.*" \
  -Dbenchmark.projectRoot=/path/to/project \
  -Dbenchmark.ollama.url=http://localhost:11434
```

指标：Hit@1/3/5/10、MRR@10、HitScore。Hit@10 低于阈值（语义 65%，代码 75%）测试失败。

产物：
- `repograph-app/build/libs/repograph-app-0.5.0.jar` — REST 服务 + CLI（命令：`repograph`）
- `repograph-mcp/build/libs/repograph-mcp-exec.jar` — MCP stdio 服务
- `./gradlew :repograph-taint-engine:installDist` — 精确污点引擎（`build/install/repograph-taint-engine/`，供精确扫描子进程调用）

---

## 配置

编辑 `repograph-app/src/main/resources/application.yml`：

```yaml
repograph:
  qdrant:
    host: localhost
    port: 16334                       # Docker host:16334 → container:6334 (gRPC)
    collection: code_units
    vector-size: 3584                 # manutic/nomic-embed-code 输出维度
  ollama:
    base-url: http://localhost:11434
    model: manutic/nomic-embed-code
    timeout-seconds: 300
  neo4j:
    uri: bolt://localhost:7687
    user: neo4j
    password: neo4jneo4j
  index:
    batch-size:
      embed: 8
      upsert: 256
    default-strategy: AUTO
  taint:
    precise:                 # 精确污点扫描（WALA IFDS 引擎，独立进程）
      enabled: false         # 配好 java-home 与 engine-lib-dir 后置 true
      java-home: ""          # 带 jmods 的 JDK 主目录（如 JDK 21）
      engine-lib-dir: ""     # repograph-taint-engine installDist 产物 lib 目录
      timeout-seconds: 600
```

---

## 快速上手

**1. 启动 REST 服务**

```bash
java --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.5.0.jar serve
```

**2. 索引一个项目**

```bash
# 通过 CLI（直接调用管道，无需 HTTP）
java --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.5.0.jar \
  index /path/to/your/project

# 通过 REST API（异步，返回 202）
curl -X POST "http://localhost:8080/api/v1/index/project" \
  -H "Content-Type: application/json" \
  -d '{"projectRoot": "/path/to/your/project"}'

# 轮询进度
curl "http://localhost:8080/api/v1/index/project/status?projectRoot=/path/to/your/project"
```

**3. 语义检索**

```bash
curl "http://localhost:8080/api/v1/search/semantic?q=HTTP+REST+endpoint+handler&lang=java&limit=10"
```

---

## CLI 命令

```
repograph index <projectRoot>        扫描并建立向量索引和知识图谱
repograph search <query>             语义检索（自然语言）
repograph symbol <qualifiedName>     查看符号详情
repograph locate <file> <line>       定位行号所在符号
repograph callers <symbol>           查询调用者
repograph callees <symbol>           查询被调用者
repograph impact <symbol>            影响面分析
repograph subtypes <type>            查找子类与实现
repograph entrypoints                列出框架入口点
repograph projects                   列出已索引项目
repograph stats <projectId>          项目统计信息
repograph sbom <projectId>           生成 SBOM
repograph delete <projectRoot>       删除项目索引
repograph watch <projectRoot>        监听文件变更并增量更新
repograph serve                      启动 REST 服务
repograph complexity <projectId>     圈复杂度分析
repograph coupling <projectId>       耦合（不稳定度）分析
repograph cycles <projectId>         包循环依赖检测
repograph hotspots <projectId>       Git 变更热点
repograph deadcode <projectId>       死代码检测
repograph testgap <projectId>        测试空白检测
repograph report <projectId>         代码健康报告（六维度 + 健康分）
repograph export <projectId>         包级依赖图导出（DOT / Mermaid）
repograph vuln scan-code <projectId>              代码漏洞扫描
repograph vuln scan-deps <projectId> <root>       依赖漏洞扫描
repograph vuln list <projectId>                   列出发现记录
repograph vuln report <projectId> [--out FILE]    生成漏洞报告
```

常用选项（`index` 命令）：

```
--lang java,c,python    指定解析语言（默认全部）
--strategy auto         解析策略：auto / precise / heuristic
--no-incremental        强制全量重新索引
```

---

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/index/project` | 异步启动索引（返回 202） |
| `GET` | `/api/v1/index/project/status` | 查询索引进度 |
| `POST` | `/api/v1/index/file` | 索引单个文件 |
| `DELETE` | `/api/v1/index/project` | 删除项目索引 |
| `GET` | `/api/v1/search/semantic` | 自然语言语义检索 |
| `GET` | `/api/v1/search/code` | 代码片段相似检索 |
| `GET` | `/api/v1/search/keyword` | 关键词检索（函数名 / CVE / CWE / 规则 ID / 配置 key） |
| `GET` | `/api/v1/search/graphrag` | GraphRAG 检索（向量 + 调用图 + 影响面 + 安全重排序） |
| `GET` | `/api/v1/context/pack` | 构建带 citation 的 Agent 上下文包 |
| `GET` | `/api/v1/symbol/{qualifiedName}` | 查看符号详情 |
| `GET` | `/api/v1/locate` | 定位行号所在符号 |
| `GET` | `/api/v1/graph/callers` | 查询调用者 |
| `GET` | `/api/v1/graph/callees` | 查询被调用者 |
| `GET` | `/api/v1/graph/impact` | 影响面分析 |
| `GET` | `/api/v1/graph/subtypes` | 查找子类与实现 |
| `GET` | `/api/v1/graph/entrypoints` | 列出框架入口点 |
| `GET` | `/api/v1/flow/analyze` | 按需生成方法级数据流摘要、CFG 与轻量 PDG |
| `GET` | `/api/v1/flow/taint` | 跨过程污点追踪（source 方法 → Sink） |
| `GET` | `/api/v1/metrics/complexity` | 圈复杂度排名 |
| `GET` | `/api/v1/metrics/coupling` | 耦合（不稳定度）分析 |
| `GET` | `/api/v1/metrics/cycles` | 包循环依赖检测 |
| `GET` | `/api/v1/metrics/hotspots` | Git 变更热点 |
| `GET` | `/api/v1/metrics/report` | 代码健康报告（六维度 + 健康分） |
| `GET` | `/api/v1/export/graph` | 包级依赖图导出（DOT / Mermaid） |
| `GET` | `/api/v1/projects` | 列出已索引项目 |
| `GET` | `/api/v1/projects/{projectId}/stats` | 项目统计 |
| `GET` | `/api/v1/frameworks/{projectId}` | 框架注解分析 |
| `GET` | `/api/v1/sbom/{projectId}` | 生成 SBOM |
| `GET` | `/api/v1/health` | 健康检查 |

> 漏洞相关接口（`/api/v1/vulns/*`）见下方[漏洞管理](#漏洞管理)。

---

## MCP 服务（AI 工具集成）

RepoGraph 提供 MCP stdio 服务，可接入 Cursor 等任何支持 MCP 协议的 AI 工具。

**MCP 客户端配置示例**（`mcpServers` 格式）：

```json
{
  "mcpServers": {
    "repograph": {
      "command": "java",
      "args": [
        "-jar", "/path/to/repograph-mcp-exec.jar",
        "--base-url", "http://localhost:8080"
      ]
    }
  }
}
```

**可用 MCP 工具**：

| 工具 | 说明 |
|------|------|
| `search_semantic` | 自然语言检索代码 |
| `search_keyword` | 关键词检索（函数名 / CVE / CWE / 规则 ID / 配置 key） |
| `search_code` | 代码片段相似检索 |
| `search_graphrag` | GraphRAG 检索（向量 + 调用图 + 影响面 + 安全重排序） |
| `build_context_pack` | 构建带 citation 的 Agent 上下文包 |
| `triage_finding` | 导入 Semgrep / SARIF / CodeQL 报警并生成研判报告 |
| `record_triage_feedback` | 写入人工研判反馈（真实风险 / 误报 / 待复核 / 已修复） |
| `list_triage_feedback` | 查询项目研判反馈，支持按状态过滤 |
| `lookup_symbol` | 查看符号完整信息 |
| `locate_at` | 文件行号 → 符号名 |
| `find_callers` | 查询调用者（支持深度） |
| `find_callees` | 查询被调用者（支持深度） |
| `get_impact` | 修改影响面分析 |
| `find_subtypes` | 查找子类与接口实现 |
| `find_entrypoints` | 列出框架入口点 |
| `analyze_flow` | 方法级数据流摘要 / CFG / PDG |
| `trace_taint` | 跨过程污点追踪（source 方法 → Sink） |
| `scan_vuln_code` | 触发代码漏洞扫描 |
| `list_vulns` | 列出漏洞发现记录（支持过滤） |
| `list_projects` | 列出已索引项目 |
| `get_health_report` | 代码健康报告（六维度 + 健康分） |
| `trigger_index` | 触发项目索引（异步） |
| `index_status` | 查询索引进度 |

---

## GraphRAG 检索

`GET /api/v1/search/graphrag` 是高质量代码检索的推荐入口，将以下四个阶段串联为一次调用：

```
自然语言查询
  └─ 1. Code Structure Chunking（索引阶段，三层语义文本）
       └─ 2. Call Graph Retrieval（向量种子 → callers + callees 展开）
            └─ 3. Impact Expansion（影响面展开，仅安全相关节点）
                 └─ 4. Security-aware Rerank（静态信号评分 + finalScore 重排）
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `q` | string | 必填 | 自然语言查询 |
| `projectId` | string | - | 按项目过滤 |
| `lang` | string | - | 按语言过滤（java / c / python） |
| `limit` | int | 10 | 向量种子数量（上限 20） |
| `depth` | int | 1 | 调用图展开深度（上限 3） |
| `callGraph` | bool | true | 是否展开 callers + callees |
| `impactExpansion` | bool | true | 是否展开安全相关影响面节点 |
| `dataFlow` | bool | - | 旧版兼容参数；`impactExpansion` 未提供时生效 |
| `rerank` | bool | true | 是否按 finalScore 重排序 |
| `noTest` | bool | true | 是否排除测试代码 |

**返回结构：**

```json
{
  "results": [
    {
      "unit": { "qualifiedName": "...", "kind": "METHOD", ... },
      "vectorScore": 0.92,
      "securityScore": 0.7,
      "finalScore": 1.27,
      "source": "VECTOR",
      "relation": "SEED",
      "securitySignals": ["entry_point", "security_annotation:preauthorize"]
    },
    {
      "unit": { ... },
      "vectorScore": 0.0,
      "securityScore": 0.6,
      "finalScore": 0.85,
      "source": "CALL_GRAPH",
      "relation": "CALLER",
      "securitySignals": ["sql_operation"]
    }
  ],
  "seedCount": 5,
  "callGraphExpanded": 12,
  "impactExpanded": 3,
  "securityHighlightCount": 4
}
```

**安全评分信号（Security-aware Rerank）：**

| 信号类别 | 加分 | 触发条件 |
|---------|------|---------|
| 认证/授权方法名 | +0.3 | 认证/授权相关方法名 |
| 安全注解 | +0.3 | 安全框架注解 |
| SQL 直接执行 | +0.3 | SQL 执行调用点 |
| 命令执行 | +0.3 | OS 命令执行调用点 |
| 反序列化 | +0.3 | 反序列化方法名 |
| 加密操作 | +0.2 | 加密相关方法名 |
| 输入校验 | +0.2 | 输入校验方法名 |
| 敏感字段名 | +0.2 | 敏感字段/参数名 |
| HTTP 入口注解 | +0.1 | HTTP 入口注解 |
| 框架入口点 | +0.1 | `is_entry_point=true` |

所有信号累加后限制在 [0, 1]。`finalScore = vectorScore + 0.5 × securityScore`（种子）或 `baseScore + 0.5 × securityScore`（图展开结果）。

---

## 索引管道说明

索引**异步**执行，流程如下：

1. 扫描源文件（`.java` / `.c .h` / `.py`）
2. 增量过滤（文件级 MD5 缓存）
3. 并行解析（精确 / 启发式 / 自动策略）
4. 元数据增强（框架注解、入口点、测试标记）
5. 写入 Neo4j 图
6. 向量化（Embedding）
7. 写入向量库
8. 更新文件缓存

每个代码单元存储**两个向量**：语义向量（自然语言查询）和代码向量（代码相似检索）。

---

## 漏洞管理

> **状态：已实现（v0.5.0）**

在 GraphRAG 安全基础设施（SecurityAwareReranker + 影响面分析）之上构建的结构化漏洞管理能力，完全本地，无需联网。

### 能力范围

### 扫描路径

四条互补扫描路径，均写入同一发现记录存储：

| 扫描器 | 原理 | 速度 | 适用 |
|--------|------|------|------|
| 代码扫描 | 方法内字符串规则（9 条 CWE 规则：SQL/命令注入、XXE、弱加密、硬编码密钥、路径穿越、不安全反序列化、不安全随机数、敏感日志） | 快（秒级） | 快速普查，有误报 |
| 污点扫描 | 跨过程污点追踪（HTTP 入口 → Sink，源码级启发式） | 慢（数十秒） | 多跳污点链 |
| 精确污点扫描 | WALA IFDS 字节码级 field-sensitive（`repograph-taint-engine` 独立进程） | 慢 | 最精确；要求可编译产物 + 带 jmods 的 JDK |
| 依赖扫描 | SBOM × 离线 CVE Advisory（80 条，覆盖主流 Java 依赖） | 快 | 依赖 CVE |

### 其他能力

| 子模块 | 说明 |
|--------|------|
| **漏洞影响面分析** | 图遍历找出发现点的所有可达调用链 |
| **发现状态管理** | 状态机 `SUSPECTED → CONFIRMED → FIXED / DISMISSED`，确认后计入报告 |
| **漏洞报告** | JSON（REST）与 Markdown（CLI）双格式报告 |

### REST 接口

```
POST /api/v1/vulns/scan/code?projectId=          触发代码漏洞扫描（同步，秒级）
POST /api/v1/vulns/scan/taint?projectId=         触发污点漏洞扫描（源码级启发式）
POST /api/v1/vulns/scan/taint/precise?projectId=&classpath=&config=&rule=
                                                 触发精确污点扫描（WALA IFDS 引擎）
POST /api/v1/vulns/scan/deps?projectId=&projectRoot=  触发依赖漏洞扫描（基于 SBOM）
GET  /api/v1/vulns?projectId=&severity=&status=  列出发现记录（支持过滤）
PUT  /api/v1/vulns/{id}/status?status=           更新发现状态
GET  /api/v1/vulns/{id}/impact                   查询单条漏洞的代码影响面
GET  /api/v1/vulns/report/{projectId}            生成漏洞报告（JSON）
```

**精确污点扫描前置条件**：默认关闭。需先 `./gradlew :repograph-taint-engine:installDist`，
然后在 `repograph.taint.precise` 配置中填入带 jmods 的 JDK 路径（如 JDK 21）与引擎 lib 目录并置
`enabled: true`。引擎以独立子进程运行，与 app 的 JDK 25 互不干扰；扫描结果以
`ruleId=PRECISE_<rule>` 写入发现记录。

### CLI 命令

```
repograph vuln scan-code  <projectId>
repograph vuln scan-deps  <projectId> <projectRoot>
repograph vuln list       <projectId> [--severity HIGH] [--status SUSPECTED]
repograph vuln report     <projectId> [--out report.md] [--all]
```

### 设计约束

- **完全离线**：Advisory 数据打包至 classpath，扫描不发出外部请求
- **无误报放大**：代码扫描结果标记为 `SUSPECTED`，需人工 `CONFIRMED` 后才计入报告
- **与 SBOM 联动**：依赖漏洞扫描以 `repograph sbom` 产出的 CycloneDX JSON 为输入

---

## 开发计划

### 方向

RepoGraph 的后续产品主线收敛为：**面向企业研发安全团队的 AI Native SAST 报警研判与修复 Agent**。
它不是从零重做一个完整扫描器，而是接入 CodeQL、Semgrep、SonarQube、Fortify、Checkmarx、SCA、CI/CD
和 Git 仓库中的扫描结果，把报警转化为可解释、可验证、可修复、可闭环的安全研判报告。

长期目标仍是 **AI Native Code Intelligence Platform**，但第一商业化切入点是 SAST 报警之后的智能决策层。
完整路线见 [roadmap-codesec-triage-agent.md](docs/generated/roadmap-codesec-triage-agent.md)。

路径分两个阶段：

```
第一阶段（已完成） 独立代码审计平台
                 在平台上完成并验证基础分析能力。

第二阶段（当前）  LLM Agent 上下文提供者
                 将 GraphRAG / Context Pack / 漏洞管理暴露为 MCP 工具。

第三阶段（下一步）SAST 报警研判 Agent
                 接入外部 SAST 报警，生成证据链、误报判断和修复建议。
```

### 第一阶段 — 审计平台 ✓

[项目能力](#项目能力) 表格中的所有功能均已实现，可通过 Web 控制台、REST API 和 CLI 使用。

### 第二阶段 — LLM Agent 集成（进行中）

已完成：

| 项目 | 说明 |
|------|------|
| `search_graphrag` MCP 工具 ✓ | Hybrid GraphRAG 管道（向量 + 关键词 → 调用图 → 影响面 → 重排序）已暴露为 MCP 工具 |
| `search_keyword` MCP 工具 ✓ | 面向函数名、配置 key、规则 ID、CVE/CWE、API 名称的精确召回 |
| `build_context_pack` MCP 工具 ✓ | 将 GraphRAG 结果组装为带 citation、预算裁剪和 omittedReasons 的上下文证据包 |
| `triage_finding` MCP 工具 ✓ | 接入 Semgrep / SARIF / CodeQL JSON，返回 verdict、证据、缺失信息、修复建议和 Markdown 报告 |
| 研判反馈 MCP 工具 ✓ | `record_triage_feedback` / `list_triage_feedback`，支持把人工确认、误报、待复核、已修复状态写回平台 |
| 安全 MCP 工具 ✓ | `trace_taint` / `list_vulns` / `scan_vuln_code` / `list_projects` |
| Agent 定向工具 ✓ | `get_health_report` / `trigger_index` / `index_status`，Agent 可自主判断索引状态并触发 |
| 精确污点引擎 ✓ | `repograph-taint-engine`（WALA IFDS）以独立进程接入，提供第四条扫描路径 |

待开发：

| 项目 | 说明 |
|------|------|
| 持久化 BM25 / FTS | 当前是轻量 BM25-like 扫描；后续用 SQLite FTS 或专用倒排索引降低大仓库查询成本 |
| 分层摘要 | 增加 chunk / 文件 / 包 / 项目级摘要，支撑全局理解与 Wiki 生成 |
| 引用校验 | 对 Context Pack citation 做行号、片段和答案覆盖性检查 |
| 跨子项目调用解析 | 改善 monorepo 内跨模块的调用边连接质量 |
| 更多语言支持 | Go（`go.mod` SBOM；Tree-sitter 解析） |

### 第三阶段 — CodeSec Triage Agent（规划中）

目标：接入现有 SAST / SCA / CI 工具结果，自动分析报警上下文，判断真实风险，生成证据链、修复建议和可审计报告。

| 阶段 | 目标 | 交付物 |
|------|------|------|
| P0 报警解释器 | 上传报警 JSON + 仓库，生成研判报告 | Semgrep / SARIF 导入、报警定位、Context Pack、Markdown 报告 |
| P1 误报研判 | 判断真实漏洞 / 误报 / 需人工确认 | source/sink 证据链、路径可达性、已有防护识别、置信度 |
| P2 PR / CI 集成 | 进入研发流程 | GitHub/GitLab PR 评论、CI 扫描结果自动研判、状态回写 |
| P3 修复闭环 | 从研判走向修复 | Patch 草案、构建/测试/规则复扫、状态机闭环 |
| P4 企业化 | 支持商业化部署 | 团队版、企业规则库、项目知识库、权限、审计日志 |

本阶段本地 PRD 和任务清单见 `.scratch/codesec-triage-agent/`。

---

## 已知局限

- 无完整 classpath，外部依赖源码缺失时调用目标解析可能失败
- Lombok / annotation processor 生成代码不可靠
- 反射、动态代理调用无法静态追踪
- C 预处理器宏展开不做，条件编译不按 build config 选择
- C 函数指针调用无法精确解析
- 精确污点扫描要求目标可编译（提供 classes/jar），且引擎须运行在带 jmods 的 JDK 上（JDK 17/21 可用，JDK 25 不含 jmods）

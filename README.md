<div align="right">

[English](README.zh.md)

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

- **语义检索**：用自然语言描述查找代码
- **代码相似检索**：通过代码片段找到相似实现
- **调用链分析**：查询调用者、被调用者与影响面
- **继承图分析**：查找子类与接口实现
- **SBOM 提取**：自动识别 Maven / Gradle / npm / pip，生成 CycloneDX JSON

**技术栈**：Java 22+，Spring Boot 3.x，Gradle（Kotlin DSL）  
**解析语言**：Java / C / Python  
**存储后端**：[Qdrant](https://qdrant.tech/)（向量）、[Neo4j](https://neo4j.com/)（图）、[Ollama](https://ollama.ai/)（Embedding）、SQLite（增量缓存）

---

## 项目能力

| 能力域 | 能力 | 说明 | 使用入口 |
| --- | --- | --- | --- |
| 代码解析 | Java | AST 解析，提取类型、方法、字段、注解与调用边 | `repograph index` / 索引页面 |
| 代码解析 | C / Python | Tree-sitter 解析；失败时自动降级 | `repograph index` / 索引页面 |
| 代码解析 | 字节码 | 可选 `.class` 分析 | 索引时指定 `class` 语言 |
| 索引 | 增量索引 | 文件级缓存，仅处理变更文件 | `repograph index` / `POST /api/v1/index/project` |
| 索引 | 文件监听 | 监听增删改，自动触发增量更新 | `repograph watch` / 项目概览 |
| 索引 | 多项目管理 | 稳定 ID、隔离存储与统计管理 | 顶部项目选择器 / `repograph projects` |
| 向量检索 | 语义搜索 | 自然语言 → 代码单元 | 搜索页面 / `search_semantic` |
| 向量检索 | 代码相似搜索 | 代码片段 → 相似实现 | 搜索页面 / `search_code` |
| GraphRAG | 调用图展开 | 向量种子 → callers + callees 展开 | `GET /api/v1/search/graphrag` |
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
| 框架分析 | 入口点识别 | Spring MVC、JAX-RS、MyBatis 注解识别与标记 | 图谱入口点 / 项目工具 |
| SBOM | Maven | `pom.xml` → CycloneDX JSON（`pkg:maven`） | `repograph sbom` / 项目工具 |
| SBOM | Gradle | `build.gradle[.kts]` + `libs.versions.toml` → CycloneDX JSON（`pkg:maven`） | `repograph sbom` / 项目工具 |
| SBOM | npm | `package.json` → CycloneDX JSON（`pkg:npm`），支持 scoped 包 | `repograph sbom` / 项目工具 |
| SBOM | pip | `pyproject.toml` + `requirements*.txt` → CycloneDX JSON（`pkg:pypi`） | `repograph sbom` / 项目工具 |
| 可视化 | Web 控制台 | 搜索、代码图、流分析、统计、索引与健康状态 | `http://localhost:8080` |
| AI 集成 | MCP stdio 服务 | 搜索、符号、调用链、影响面等 MCP 工具 | `repograph-mcp` |
| 质量评测 | 检索 Benchmark | Hit@1/3/5/10、MRR@10、HitScore 及阈值门禁 | Benchmark 页面 / Gradle 测试 |
| 容错 | 解析降级 | 解析失败自动降级，不阻断整体流程 | 索引管道 |

> 流分析当前仅支持 Java；数据依赖为保守启发式估算，不构建 SSA。

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

**本地漏洞管理，代码 + 依赖全覆盖**  
9 条 CWE 标注静态规则 + 离线 CVE 数据库（80 条，覆盖主流 Java 依赖）。发现记录走状态机确认流程，结合图遍历输出调用链影响面。完全离线，无需外部扫描服务。

**多生态 SBOM，一条命令生成**  
自动识别 Maven、Gradle、npm、pip，输出 CycloneDX JSON，直接衔接依赖漏洞扫描。

**MCP 原生集成，直接接入 AI 工具**  
独立 MCP stdio 服务（`repograph-mcp`），Claude Desktop、Cursor 等工具直接调用，无需中间层。

---

## 模块结构

两个可独立部署的 JAR：

```
repograph-app/   Spring Boot 服务 + Picocli CLI（REST API、索引管道、检索）
  ├─ core/        领域模型 + 接口定义（CodeUnit / VectorStore / GraphQueryService）
  ├─ parser/      JavaParser AST、Tree-sitter FFM（C/Python）、启发式状态机
  ├─ graph/       Neo4j Bolt 门面（调用链 / 影响面 / 继承图）
  ├─ vector/      Qdrant gRPC（向量存储）+ Ollama（Embedding）
  ├─ framework/   Spring / JAX-RS 注解识别，标记入口点
  ├─ sbom/        Maven / Gradle / npm / pip → CycloneDX JSON
  ├─ api/         Spring MVC REST 控制器
  └─ app/         Picocli CLI + 索引管道 + Spring Boot 入口

repograph-mcp/   独立 MCP stdio 服务（供 AI 工具调用，通过 HTTP 转发至 repograph-app）
```

---

## 前置依赖

| 服务 | 启动方式 |
|------|----------|
| **Qdrant** | `docker run -d -p 16333:6333 -p 16334:6334 qdrant/qdrant` |
| **Neo4j** | `docker run -d -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/neo4jneo4j neo4j:5` |
| **Ollama** | 本机或远端启动，拉取模型 `ollama pull manutic/nomic-embed-code` |
| **Java 22+** | 需开启 `--enable-preview --enable-native-access=ALL-UNNAMED` |

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
- `repograph-app/build/libs/repograph-app-0.1.0-SNAPSHOT.jar` — REST 服务 + CLI（命令：`repograph`）
- `repograph-mcp/build/libs/repograph-mcp-exec.jar` — MCP stdio 服务

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
```

---

## 快速上手

**1. 启动 REST 服务**

```bash
java --enable-preview --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.1.0-SNAPSHOT.jar serve
```

**2. 索引一个项目**

```bash
# 通过 CLI（直接调用管道，无需 HTTP）
java --enable-preview --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.1.0-SNAPSHOT.jar \
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
| `GET` | `/api/v1/search/graphrag` | GraphRAG 检索（向量 + 调用图 + 影响面 + 安全重排序） |
| `GET` | `/api/v1/symbol/{qualifiedName}` | 查看符号详情 |
| `GET` | `/api/v1/locate` | 定位行号所在符号 |
| `GET` | `/api/v1/graph/callers` | 查询调用者 |
| `GET` | `/api/v1/graph/callees` | 查询被调用者 |
| `GET` | `/api/v1/graph/impact` | 影响面分析 |
| `GET` | `/api/v1/graph/subtypes` | 查找子类与实现 |
| `GET` | `/api/v1/graph/entrypoints` | 列出框架入口点 |
| `GET` | `/api/v1/flow/analyze` | 按需生成方法级数据流摘要、CFG 与轻量 PDG |
| `GET` | `/api/v1/projects` | 列出已索引项目 |
| `GET` | `/api/v1/projects/{projectId}/stats` | 项目统计 |
| `GET` | `/api/v1/frameworks/{projectId}` | 框架注解分析 |
| `GET` | `/api/v1/sbom/{projectId}` | 生成 SBOM |
| `GET` | `/api/v1/health` | 健康检查 |

---

## MCP 服务（AI 工具集成）

RepoGraph 提供 MCP stdio 服务，可接入 Claude Desktop、Cursor 等支持 MCP 协议的 AI 工具。

**Claude Desktop 配置**（`claude_desktop_config.json`）：

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
| `search_code` | 代码片段相似检索 |
| `lookup_symbol` | 查看符号完整信息 |
| `locate_at` | 文件行号 → 符号名 |
| `find_callers` | 查询调用者（支持深度） |
| `find_callees` | 查询被调用者（支持深度） |
| `get_impact` | 修改影响面分析 |
| `find_subtypes` | 查找子类与接口实现 |
| `find_entrypoints` | 列出框架入口点 |

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

| 子模块 | 说明 |
|--------|------|
| **代码漏洞扫描** | 9 条 CWE 标注规则：SQL/命令注入、XXE、弱加密、硬编码密钥、路径穿越、不安全反序列化、不安全随机数、敏感日志 |
| **依赖漏洞扫描** | 离线 CVE 数据库（80 条，覆盖主流 Java 依赖），基于 SBOM 比对 |
| **漏洞影响面分析** | 图遍历找出发现点的所有可达调用链 |
| **发现状态管理** | 状态机 `SUSPECTED → CONFIRMED → FIXED / DISMISSED`，确认后计入报告 |
| **漏洞报告** | JSON（REST）与 Markdown（CLI）双格式报告 |

### REST 接口

```
POST /api/v1/vulns/scan/code?projectId=          触发代码漏洞扫描（同步，秒级）
POST /api/v1/vulns/scan/deps?projectId=&projectRoot=  触发依赖漏洞扫描（基于 SBOM）
GET  /api/v1/vulns?projectId=&severity=&status=  列出发现记录（支持过滤）
PUT  /api/v1/vulns/{id}/status?status=           更新发现状态
GET  /api/v1/vulns/{id}/impact                   查询单条漏洞的代码影响面
GET  /api/v1/vulns/report/{projectId}            生成漏洞报告（JSON）
```

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

RepoGraph 的终极目标是：**让 LLM 以 Agent 身份在大型代码库中按需定位上下文**——不需要把整个仓库塞进上下文窗口，而是让 Agent 像用工具一样按需查询知识图谱。

路径分两个阶段：

```
第一阶段（当前）  独立代码审计平台
                在平台上完成并验证所有分析能力。

第二阶段（下一步） LLM Agent 上下文提供者
                将验证过的能力暴露为 MCP 工具，
                让 Agent 以工具调用方式迭代查询。
```

### 第一阶段 — 审计平台 ✓

[项目能力](#项目能力) 表格中的所有功能均已实现，可通过 Web 控制台、REST API 和 CLI 使用。

### 第二阶段 — LLM Agent 集成

| 项目 | 说明 |
|------|------|
| `search_graphrag` MCP 工具 | 将四阶段 GraphRAG 管道（向量 → 调用图 → 影响面 → 重排序）暴露为 MCP 工具；当前仅 REST 可达 |
| MCP 工具结果加 `rawSource` | 现有工具只返回元数据；加入源码文本后 Agent 无需额外读文件即可理解方法实现 |
| 跨子项目调用解析 | 改善 monorepo 内跨模块的调用边连接质量 |
| 更多语言支持 | Go（`go.mod` SBOM；Tree-sitter 解析） |

---

## 已知局限

- 无完整 classpath，外部依赖源码缺失时调用目标解析可能失败
- Lombok / annotation processor 生成代码不可靠
- 反射、动态代理调用无法静态追踪
- C 预处理器宏展开不做，条件编译不按 build config 选择
- C 函数指针调用无法精确解析

# RepoGraph 使用手册

> 版本：0.1.0 · 最后更新：2026-06

---

## 目录

1. [概述](#1-概述)
2. [前置依赖](#2-前置依赖)
3. [快速开始](#3-快速开始)
4. [配置参考](#4-配置参考)
5. [CLI 命令参考](#5-cli-命令参考)
6. [REST API 参考](#6-rest-api-参考)
7. [MCP 服务器](#7-mcp-服务器)
8. [Dashboard 使用指南](#8-dashboard-使用指南)
9. [核心概念](#9-核心概念)
10. [已知局限](#10-已知局限)
11. [故障排查](#11-故障排查)

---

## 1. 概述

RepoGraph 是一个**本地代码知识图谱**工具，通过静态分析将代码库转化为可检索、可查询的知识库：

| 能力 | 说明 |
|------|------|
| **语义检索** | 自然语言 → 代码单元（基于 Ollama Embedding） |
| **代码相似检索** | 代码片段 → 结构相似实现 |
| **调用链分析** | 谁调用了 X / X 调用了谁（双向，可设深度） |
| **影响面分析** | 变更 X 后会影响哪些代码 |
| **类型层次查询** | 谁继承/实现了 X |
| **符号定位** | file:line → 包含该行的符号 |
| **SBOM 生成** | Maven pom.xml → CycloneDX JSON |
| **AI Agent 集成** | MCP stdio 协议，工具直接对接 Cursor 等 MCP 客户端 |

**支持语言**：Java（JavaParser AST）、C/C++（Tree-sitter）、Python（Tree-sitter）

---

## 2. 前置依赖

### 2.1 必须

| 依赖 | 版本 | 用途 |
|------|------|------|
| Java | 22+ | 运行 RepoGraph |
| [Qdrant](https://qdrant.tech/documentation/guides/installation/) | 任意 | 向量存储 |
| [Ollama](https://ollama.com) | 任意 | Embedding 模型 |
| [Neo4j](https://neo4j.com/docs/operations-manual/current/installation/) | 5.x | 代码知识图谱 |

### 2.2 Qdrant 启动（Docker）

```bash
docker run -d --name qdrant \
  -p 16333:6333 \
  -p 16334:6334 \
  -v $(pwd)/qdrant_data:/qdrant/storage \
  qdrant/qdrant
```

- `16333` → HTTP REST（用于调试）
- `16334` → gRPC（RepoGraph 使用）

### 2.3 Neo4j 启动（Docker）

```bash
docker run -d --name neo4j \
  -p 7474:7474 \
  -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/neo4jneo4j \
  -v $(pwd)/neo4j_data:/data \
  neo4j:5
```

- `7474` → 浏览器 UI（调试用，访问 `http://localhost:7474`）
- `7687` → Bolt 协议（RepoGraph 使用）
- `NEO4J_AUTH=user/password`：与 `application.yml` 的 `repograph.neo4j` 块对应

### 2.4 Ollama 模型安装

```bash
ollama pull manutic/nomic-embed-code
```

> **说明**：该模型输出 3584 维向量。若使用其他模型，需同步修改 `repograph.qdrant.vector-size` 和 `repograph.ollama.model`。

---

## 3. 快速开始

### 3.1 构建

```bash
git clone <repo>
cd code-vector-db
./gradlew :repograph-app:bootJar
```

产物：`repograph-app/build/libs/repograph-app-*.jar`

### 3.2 修改配置

编辑 `repograph-app/src/main/resources/application.yml`（或在命令行用 `-D` 覆盖）：

```yaml
repograph:
  qdrant:
    host: localhost
    port: 16334
  ollama:
    base-url: http://localhost:11434
  neo4j:
    uri: bolt://localhost:7687
    user: neo4j
    password: neo4jneo4j
```

> 图持久化由 Neo4j 自身负责，无需配置启动加载路径——重启服务后图查询立即可用。

### 3.3 索引项目

```bash
# 方式一：CLI 直接索引（阻塞，适合脚本）
java -jar repograph-app.jar index /path/to/your/project --lang java

# 方式二：启动服务后通过 REST 触发（异步）
java -jar repograph-app.jar serve &
curl -X POST "http://localhost:8080/api/v1/index/project?projectRoot=/path/to/your/project"
```

也可以上传 ZIP/TAR.GZ 源码包。服务会在受控目录安全解压并异步索引：

```bash
curl -X POST "http://localhost:8080/api/v1/assets/import" \
  -F "file=@my-project.zip" \
  -F "lang=java"
```

轮询至 `READY` 后可生成资产画像和扫描器建议：

```bash
curl "http://localhost:8080/api/v1/assets/{assetId}/profile"
```

### 3.4 开始搜索

```bash
# 语义搜索
java -jar repograph-app.jar search "HTTP 请求处理入口"

# 查调用方
java -jar repograph-app.jar callers "com.example.UserService#findById"

# 打开 Dashboard
open http://localhost:8080
```

---

## 4. 配置参考

所有配置项位于 `application.properties`，均支持环境变量和 `-D` JVM 参数覆盖。

### 4.1 Qdrant

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `repograph.qdrant.host` | `localhost` | Qdrant 主机 |
| `repograph.qdrant.port` | `16334` | gRPC 端口 |
| `repograph.qdrant.collection` | `code_units` | 集合名，首次索引自动创建 |
| `repograph.qdrant.vector-size` | `3584` | 向量维度，需与模型匹配 |

### 4.2 Ollama

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `repograph.ollama.base-url` | `http://localhost:11434` | Ollama API 地址 |
| `repograph.ollama.model` | `manutic/nomic-embed-code` | Embedding 模型 |
| `repograph.ollama.timeout-seconds` | `300` | 单次请求超时（大模型较慢） |

### 4.3 索引管道

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `repograph.index.db-path` | `~/.repograph/index.db` | 增量缓存 SQLite 数据库 |
| `repograph.index.batch-size.embed` | `8` | 每批 Embedding 数量 |
| `repograph.index.batch-size.upsert` | `256` | 每批写入 Qdrant 数量 |
| `repograph.index.default-strategy` | `AUTO` | 解析策略，见 §9.2 |

### 4.4 Neo4j

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `repograph.neo4j.uri` | 无 | Bolt URI，例如 `bolt://localhost:7687` |
| `repograph.neo4j.user` | 无 | Neo4j 用户名 |
| `repograph.neo4j.password` | 无 | Neo4j 密码 |

> 图存储已迁移到 Neo4j 5.x（外部服务）。重启 repograph serve 不会丢图，无需启动加载步骤。
> 索引时数据直接写入 Neo4j；查询时通过 Cypher 实时遍历。

### 4.5 归档资产

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `repograph.assets.root-dir` | `~/.repograph/assets` | RepoGraph 托管源码根目录 |
| `repograph.assets.max-upload-mb` | `200` | 最大归档上传大小，同时用于 multipart 限制 |
| `repograph.assets.max-extracted-mb` | `1024` | 最大累计解压大小 |
| `repograph.assets.max-entries` | `50000` | 最大归档条目数 |
| `repograph.assets.max-single-file-mb` | `50` | 最大单文件解压大小 |
| `repograph.assets.max-depth` | `32` | 最大归档目录深度 |

仅支持按文件内容识别的 ZIP 和 TAR.GZ。包含路径穿越、绝对路径、重复目标、符号链接、硬链接或
特殊文件的归档会被拒绝。

### 4.6 外部扫描器

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `repograph.scanners.work-dir` | `~/.repograph/scans` | 受控数据库、日志和结果根目录 |
| `repograph.scanners.default-timeout-seconds` | `900` | 单阶段扫描超时及客户端可请求的最大值 |
| `repograph.scanners.max-output-mb` | `100` | 单个 JSON/SARIF 输出文件上限 |
| `repograph.scanners.max-findings` | `5000` | 单次工具运行最多导入报警数 |
| `repograph.scanners.semgrep-command` | `semgrep` | Semgrep 可执行文件或绝对路径 |
| `repograph.scanners.semgrep-config` | `auto` | Semgrep `--config` 参数 |
| `repograph.scanners.codeql-command` | `codeql` | CodeQL 可执行文件或绝对路径 |
| `repograph.scanners.codeql-query-suite` | `security-extended` | CodeQL 查询套件名或完整查询标识 |

工具命令必须是单个可执行文件，不支持 shell 片段。CodeQL 当前只自动执行支持
`--build-mode=none` 的语言，不会调用项目构建脚本。

### 4.7 LLM 辅助复核

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `repograph.advisory.enabled` | `false` | 是否允许调用已安装的模型适配器 |
| `repograph.advisory.max-input-chars` | `12000` | 脱敏后最大输入字符数 |
| `repograph.advisory.max-output-chars` | `4000` | 模型最大输出字符数 |
| `repograph.advisory.max-estimated-cost-usd` | `0.05` | 单次调用最大预估美元成本 |
| `repograph.advisory.timeout-millis` | `15000` | 单次尝试超时 |
| `repograph.advisory.max-retries` | `1` | 可重试异常或超时的最大重试次数 |
| `repograph.advisory.redact` | `true` | 是否脱敏常见密码、令牌和 API key |

默认发行版只注册关闭模型，不会向外部服务发送源码。部署方必须先明确允许的模型提供方、数据出域和
脱敏策略，再实现 `LlmAdvisoryModel` 适配器；仅将 `enabled` 改为 `true` 不会启用外部调用。

### 4.8 服务器

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `server.port` | `8080` | HTTP 端口 |

---

## 5. CLI 命令参考

### 入口

```bash
java -jar repograph-app.jar [子命令] [选项]
java -jar repograph-app.jar --help   # 全局帮助
```

---

### 5.1 `serve` — 启动 REST 服务

```bash
java -jar repograph-app.jar serve [--port PORT]
```

| 选项 | 说明 |
|------|------|
| `--port` | 覆盖监听端口（默认 8080） |

**示例**

```bash
java -jar repograph-app.jar serve
# → 访问 http://localhost:8080 打开 Dashboard
```

---

### 5.2 `index` — 建立索引

```bash
java -jar repograph-app.jar index <projectRoot> [选项]
```

| 选项 | 说明 |
|------|------|
| `<projectRoot>` | **必填**，项目根目录绝对路径 |
| `--lang` | 目标语言，逗号分隔，如 `java,python`；默认全部 |
| `--strategy` | 解析策略：`auto`（默认）、`precise`、`heuristic` |
| `--no-incremental` | 禁用增量，强制全量重新解析 |
| `--db` | 覆盖缓存数据库路径 |

**示例**

```bash
# 全量索引 Java 项目
java -jar repograph-app.jar index /projects/my-service --lang java

# 强制重建，同时索引 Java 和 Python
java -jar repograph-app.jar index /projects/my-service --lang java,python --no-incremental

# 输出（stderr）
# Indexed 1284 files (18432 units, 62817 edges) in 187340 ms
```

> **索引速度**：取决于 Ollama 服务的 Embedding 吞吐量。本地 GPU 约 10 万单元/小时，远程 CPU 服务约 1 万单元/小时。

---

### 5.3 `search` — 语义 / 代码检索

```bash
java -jar repograph-app.jar search <query> [选项]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `<query>` | — | 查询字符串（自然语言或代码片段） |
| `--mode` | `semantic` | `semantic`（NL→代码）或 `code`（代码→相似实现） |
| `--lang` | — | 语言过滤：`java` / `c` / `python` |
| `--kind` | — | 符号类型过滤：`METHOD`、`CLASS`、`FUNCTION` 等 |
| `--limit` | `10` | 最大结果数 |
| `--project` | — | 按项目 ID 过滤 |
| `--entry-only` | false | 仅返回入口点（HTTP 接口、Controller 方法等） |
| `--no-test` | false | 排除测试代码 |
| `--format` | `table` | 输出格式：`table` 或 `json` |

**示例**

```bash
# 查找所有 HTTP 接口
java -jar repograph-app.jar search "HTTP REST 接口处理" --entry-only --lang java

# 查找与某段代码相似的实现
java -jar repograph-app.jar search "public void process(String input)" --mode code

# JSON 格式输出（管道处理）
java -jar repograph-app.jar search "数据库连接" --format json | jq '.[0].unit.qualifiedName'
```

**Table 输出格式**

```
SCORE    KIND         LANG       QUALIFIED_NAME
-----------------------------------------------------------------------------------------------
0.9231   METHOD       java       com.example.api.UserController#getUser(Long)
0.8914   METHOD       java       com.example.api.OrderController#createOrder(OrderRequest)
```

---

### 5.4 `callers` — 查调用方

```bash
java -jar repograph-app.jar callers <qualifiedName> [--depth N]
```

| 参数 | 说明 |
|------|------|
| `<qualifiedName>` | 目标符号全限定名 |
| `--depth` | 遍历深度（默认 3）；`1` = 仅直接调用方 |

**全限定名格式**

| 符号类型 | 格式示例 |
|---------|---------|
| 方法（无参） | `com.example.Foo#bar` |
| 方法（有参） | `com.example.Foo#bar(String,int)` |
| 类 | `com.example.Foo` |
| C 函数 | `parse_request` |
| Python 方法 | `MyService#process` |

**示例**

```bash
java -jar repograph-app.jar callers "com.example.UserService#findById" --depth 2
```

---

### 5.5 `impact` — 影响面分析

```bash
java -jar repograph-app.jar impact <qualifiedName>
```

返回所有直接和间接依赖该符号的代码单元（含调用方、子类、字段类型绑定等）。

**示例**

```bash
# 重构前评估影响
java -jar repograph-app.jar impact "com.example.core.Repository#save"
```

---

### 5.6 `symbol` — 精确查找符号

```bash
java -jar repograph-app.jar symbol <qualifiedName>
```

按全限定名精确查找，输出完整 JSON（含源码、元数据）。

**示例**

```bash
java -jar repograph-app.jar symbol "com.example.Foo#bar(String)"
```

---

### 5.7 `locate` — 按文件行号定位

```bash
java -jar repograph-app.jar locate --file <path> --line <n>
```

| 选项 | 说明 |
|------|------|
| `--file` | 相对于 projectRoot 的文件路径 |
| `--line` | 1-based 行号 |

**示例**

```bash
# 从栈帧定位到符号
java -jar repograph-app.jar locate \
  --file src/main/java/com/example/UserService.java \
  --line 42
```

---

### 5.8 `sbom` — 生成软件物料清单

```bash
java -jar repograph-app.jar sbom <projectRoot> [--format cyclonedx]
```

解析 `pom.xml`，输出 CycloneDX JSON 格式的依赖清单到 stdout。

**示例**

```bash
java -jar repograph-app.jar sbom /projects/my-service > sbom.json
```

---

## 6. REST API 参考

启动服务后，所有接口均在 `http://localhost:8080` 可用。

### 6.1 索引

#### `POST /api/v1/index/project` — 触发项目索引（异步）

```
POST /api/v1/index/project
  ?projectRoot=/path/to/project   必填
  &lang=java,python               可选，逗号分隔
  &strategy=auto                  可选：auto / precise / heuristic
  &noIncremental=false            可选：true 强制全量
```

响应：`202 Accepted`

```json
{ "status": "running", "message": "Indexing started" }
```

#### `GET /api/v1/index/project/status` — 查询索引状态

```
GET /api/v1/index/project/status?projectRoot=/path/to/project
```

响应：

```json
{
  "status": "done",
  "totalFiles": 1284,
  "parsedFiles": 1284,
  "totalUnits": 18432,
  "totalEdges": 62817,
  "degradedFiles": 12,
  "durationMs": 187340,
  "errors": []
}
```

`status` 取值：`running` / `done` / `error:<message>`

#### `POST /api/v1/index/file` — 索引单个文件

```
POST /api/v1/index/file
  ?file=src/main/java/Foo.java
  &projectRoot=/path/to/project
  &strategy=auto
```

#### `POST /api/v1/assets/import` — 上传并索引源码归档

请求为 `multipart/form-data`：

```bash
curl -X POST "http://localhost:8080/api/v1/assets/import" \
  -F "file=@my-project.tar.gz" \
  -F "lang=java,python" \
  -F "strategy=auto"
```

成功返回 `202 Accepted`：

```json
{
  "assetId": "622a7e55-271f-499d-b21f-f98d04fe9822",
  "projectId": "a1b2c3d4e5f6",
  "archiveType": "TAR_GZ",
  "projectRoot": "/home/user/.repograph/assets/622a7e55-271f-499d-b21f-f98d04fe9822/source/project",
  "status": "INDEXING",
  "pollUrl": "/api/v1/assets/622a7e55-271f-499d-b21f-f98d04fe9822"
}
```

#### `GET /api/v1/assets/{assetId}` — 查询归档资产状态

`status` 取值为 `INDEXING / READY / FAILED`。`READY` 时返回 `indexResult`，`FAILED` 时返回
错误摘要并保留源码供诊断。

#### `GET /api/v1/assets/{assetId}/profile` — 生成资产画像

仅对 `READY` 资产开放；`INDEXING` 或 `FAILED` 返回 `409 ASSET_NOT_READY`。画像包含逐文件分类及原因、
语言分布、框架、构建系统、CycloneDX 依赖、风险信号和扫描器推荐。文件分类为：
`BUSINESS / TEST / DOCUMENTATION / GENERATED / UNKNOWN`。

```bash
curl "http://localhost:8080/api/v1/assets/{assetId}/profile\
?includeScanner=SLITHER&excludeScanner=SEMGREP"
```

`includeScanner` 和 `excludeScanner` 可重复传入；冲突时排除优先。支持的扫描器标识为
`REPOGRAPH_CODE`、`REPOGRAPH_TAINT`、`REPOGRAPH_PRECISE_TAINT`、`SEMGREP`、`CODEQL`、
`SLITHER`、`DEPENDENCY_CVE`。画像只生成执行建议，不会启动外部扫描器。

风险信号可能包含公开 HTTP 入口、危险 Sink、敏感配置、依赖 CVE 和高变更热点。敏感配置证据仅返回
文件路径，不返回密码、令牌等配置值。SBOM、图谱或 Git 信息不可用时，原因记录在 `omittedReasons`。

#### `GET /api/v1/assets/{assetId}/authorization-evidence` — 查询路由鉴权证据

仅对 `READY` 资产开放。当前支持 Java/Spring，从控制器和处理方法提取 HTTP 路径、方法及
`@PreAuthorize`、`@PostAuthorize`、`@Secured`、`@RolesAllowed`、`@PermitAll`、`@DenyAll`
约束候选，并沿调用图关联数据库、文件、网络和危险 Sink：

```bash
curl "http://localhost:8080/api/v1/assets/{assetId}/authorization-evidence?depth=6"
```

`depth` 默认为 6，服务端限制为 0–12。每条结果包含：

- `route`：合并后的路径、HTTP 方法、处理器和源码 citation；
- `constraints`：类级、方法级或配置级候选及 `effective` 标记；
- `resourceAccesses`：目标类型、匹配 API、有序调用路径和逐跳 citation；
- `missingInfo`：过滤器、网关、代理和动态策略等当前无法确认的信息。

`status` 取值为 `LOCAL_CONSTRAINT_CANDIDATE / POLICY_CANDIDATE / NO_LOCAL_EVIDENCE`。
这些状态只描述静态证据强度；`NO_LOCAL_EVIDENCE` 不表示已确认端点未鉴权，配置候选也不表示已确认
覆盖当前路由。领域模型另保留 `CONFIRMED_UNAUTHENTICATED` 给运行时验证或人工证据，当前静态接口
不会自动产生该状态。

#### `DELETE /api/v1/assets/{assetId}` — 删除归档资产

删除图、向量、增量缓存、漏洞记录、索引历史、外部扫描记录、受控扫描输出和受控源码。
资产仍在索引时返回 `409 Conflict`；不存在时返回 `404 Not Found`。

#### `GET /api/v1/scanners/capabilities` — 探测外部扫描器

返回 Semgrep/CodeQL 支持语言、所需命令、输出格式、版本和当前可用性。命令未安装时
`available=false` 并返回原因，不表示扫描成功或零报警。

#### `POST /api/v1/assets/{assetId}/scans` — 执行外部扫描

仅允许扫描 `READY` 的 RepoGraph 托管资产。请求为空时使用资产画像推荐的 Semgrep/CodeQL：

```bash
curl -X POST "http://localhost:8080/api/v1/assets/{assetId}/scans" \
  -H "Content-Type: application/json" \
  -d '{}'
```

也可显式选择工具和更短超时：

```json
{
  "scanners": ["SEMGREP", "CODEQL"],
  "timeoutSeconds": 300
}
```

响应为同步批次结果，状态为 `SUCCEEDED / PARTIAL / FAILED`；每个运行独立返回
`SUCCEEDED / PARTIAL / FAILED / TIMED_OUT / UNAVAILABLE`、工具版本、退出码、耗时、错误和报警。
单个工具失败不会丢弃其他工具结果。

同步端点适合小项目即时扫描；批量或长扫描请用下面的异步任务端点。服务端仍会在超时后强制终止子进程。

#### 异步扫描任务（T10-1）

提交后立即返回任务标识，不阻塞等待扫描完成，用轮询查状态：

```bash
# 提交，返回 202 {"taskId":"...","status":"QUEUED"}
curl -X POST "http://localhost:8080/api/v1/assets/{assetId}/scan-tasks" \
  -H "Content-Type: application/json" -d '{}'

# 轮询状态，含各扫描器运行摘要与失败原因
curl "http://localhost:8080/api/v1/scan-tasks/{taskId}"

# 分页取归一化报警（按指纹去重）
curl "http://localhost:8080/api/v1/scan-tasks/{taskId}/findings?page=0&size=50"

# 取消任务（QUEUED 永不启动；RUNNING 终止扫描器子进程）
curl -X POST "http://localhost:8080/api/v1/scan-tasks/{taskId}/cancel"

# 重试 FAILED/PARTIAL 任务（只重跑未成功的扫描器）
curl -X POST "http://localhost:8080/api/v1/scan-tasks/{taskId}/retry"
```

任务态 `QUEUED → RUNNING → SUCCEEDED / PARTIAL / FAILED`：单个扫描器失败任务进入 `PARTIAL`，
其余结果仍可查询；任务级异常进入 `FAILED` 并带结构化失败原因。`cancel` 将 `QUEUED` 任务标记
`CANCELLED` 使其永不启动，`RUNNING` 任务则中断执行线程并强制终止在跑的扫描器子进程（已完成
扫描器的结果仍保留），终态任务取消为幂等 no-op。

任务提交受**并发配额**约束（`repograph.scanner.quota.global`=4、`project`=2、`scanner`=2）：超额任务留在
`QUEUED`，配额释放后按入队顺序准入（工作保守，项目/扫描器达上限不饿死其他任务），任务计入其包含的每个
扫描器。`retry` 对 `FAILED/PARTIAL` 任务只重跑未成功的扫描器（已成功的跳过），合并结果重算状态并
`attempt+1`；靠指纹幂等与去重，报警不会重复。Slither 接入为 T10 后续切片
（见 `docs/generated/t10-scan-orchestration-breakdown.md`）。

#### 外部扫描结果查询

```text
GET /api/v1/assets/{assetId}/scans
GET /api/v1/scans/{scanId}
GET /api/v1/assets/{assetId}/external-findings
```

最后一个接口返回按项目和指纹去重后的 `ExternalFinding`。重复扫描同一报警只更新时间和最近运行关联，
不会重复创建报警。

#### 版本化历史反馈与研判报告

报告请求可提供当前代码和规则版本。只有同项目、同报警指纹且两个版本完全一致的历史反馈才会参与结论：

```text
POST /api/v1/triage/report
  ?format=semgrep
  &projectId=<projectId>
  &codeVersion=<commit-sha>
  &ruleVersion=<ruleset-version>
```

写入反馈时同时保存版本：

```json
{
  "fingerprint": "a1b2c3d4e5f6a7b8",
  "projectId": "project-1",
  "status": "FALSE_POSITIVE",
  "reviewer": "leo",
  "reason": "参数来自固定枚举",
  "codeVersion": "commit-a",
  "ruleVersion": "semgrep-rules-2"
}
```

版本不一致的反馈会以 `applied=false` 保留在 `decisionEvidence`，不会自动覆盖新一轮结果。
防护代码同样只有在外部 trace 明确证明其位于所有 source 与 sink 之间时才会影响结论。

#### 规则抑制策略

```text
POST /api/v1/triage/suppressions
GET  /api/v1/triage/suppressions?projectId=<id>&ruleId=<rule>
POST /api/v1/triage/suppressions/{id}/revoke
GET  /api/v1/triage/suppressions/{id}/audit
```

创建请求必须提供 `PROJECT` 或 `FILE_GLOB` 作用域、理由、创建人和 ISO-8601 过期时间。策略过期、
撤销或文件路径不匹配后不再参与研判；创建和撤销操作均保存审计事件。

#### 漏洞变体候选

```text
GET /api/v1/triage/variants?projectId=<id>&limit=100
```

该接口从项目中状态为 `CONFIRMED` 的漏洞出发，按规则/CWE、危险 Sink、动态参数形态和源码 token
相似度召回代码变体。结果包含相似依据和源码 citation，并按指纹去重；候选状态始终为 `SUSPECTED`
或 `NEEDS_REVIEW`，不会因相似性自动确认漏洞。

#### LLM 辅助复核

```text
POST /api/v1/triage/advisory
Content-Type: application/json

<已有 TriageReport JSON>
```

响应原样携带 `heuristicReport`，并固定返回 `advisoryOnly=true`。未安装或未启用模型时状态为
`DISABLED`，`suggestedVerdict` 为空。模型可用时，服务只接受输入 Context Pack 中已有的 citation；
非法引用会进入 `missingInfo`。该接口不写入漏洞状态，不能自动生成 `CONFIRMED` 记录。

#### 审核队列

```text
POST /api/v1/review-queue/snapshots?format=semgrep&projectId=<id>&codeVersion=<sha>&ruleVersion=<v>
GET  /api/v1/review-queue?projectId=<id>&severity=&verdict=&status=&ruleId=&updatedAfter=&updatedBefore=
POST /api/v1/review-queue/{entryId}/claim    {"actor":"..."}
POST /api/v1/review-queue/{entryId}/return   {"actor":"...","reason":"..."}
POST /api/v1/review-queue/{entryId}/confirm  {"actor":"...","reason":"..."}
POST /api/v1/review-queue/{entryId}/reject   {"actor":"...","reason":"..."}
GET  /api/v1/review-queue/{entryId}/audit
GET  /api/v1/review-queue/snapshots/{snapshotId}/export?format=markdown|json|pdf
```

`POST /snapshots` 研判一批外部报警后，把结果连同 schema/工具/项目版本和生成时间一起
冻结为一份不可变 `ReportSnapshot`，并为每条报警生成一条 `PENDING` 队列条目。状态机为
`PENDING -> IN_REVIEW ->（CONFIRMED / REJECTED）`，`IN_REVIEW` 也可 `return` 退回
`PENDING`；不合法的迁移（如未认领直接 `confirm`）返回 404，不会静默生效。认领、退回、
确认、驳回均记录操作者、时间和理由，可通过 `/audit` 查询完整历史。

`export` 的 Markdown、JSON、PDF 三种格式均来自同一份快照，因此报警数、结论和证据编号天然一致。
`format=pdf` 返回 `application/pdf`（带 `Content-Disposition` 附件名），PDF 内嵌 Noto Sans SC 中文字体，
缺系统中文字体的容器/CI 环境也不会乱码；代码块与长路径自动换行，不丢失证据编号。

---

### 6.2 搜索

#### `GET /api/v1/search/semantic` — 语义检索

```
GET /api/v1/search/semantic
  ?q=HTTP 接口处理            必填
  &lang=java                  可选
  &kind=METHOD                可选
  &limit=10                   可选，默认 10
  &entryOnly=true             可选
  &noTest=true                可选
```

响应：`[{ "unit": CodeUnit, "score": 0.923 }, ...]`

#### `GET /api/v1/search/code` — 代码相似检索

```
GET /api/v1/search/code
  ?snippet=void parse(Path file)   必填
  &lang=java                       可选
  &limit=10                        可选
```

---

### 6.3 符号查询

#### `GET /api/v1/symbol/{qualifiedName}` — 精确查找

```
GET /api/v1/symbol/com.example.Foo%23bar(String)
```

`#` 需编码为 `%23`。响应：`CodeUnit` JSON 或 `404`。

#### `GET /api/v1/locate` — 行号定位

```
GET /api/v1/locate?file=src/main/java/Foo.java&line=42
```

响应：`CodeUnit` JSON 或 `404`。

---

### 6.4 图谱查询

所有图谱接口都需要先完成索引；图持久化在 Neo4j 中，服务重启后立即可用，无需重新加载。

#### `GET /api/v1/graph/callers` — 查调用方（入边）

```
GET /api/v1/graph/callers?target=com.example.Foo%23bar&depth=3
```

响应：`[CodeUnit, ...]`

#### `GET /api/v1/graph/callees` — 查被调用方（出边）

```
GET /api/v1/graph/callees?target=com.example.Foo%23bar&depth=1
```

响应：`[CodeUnit, ...]`

#### `GET /api/v1/graph/impact` — 影响面分析

```
GET /api/v1/graph/impact?target=com.example.Repository%23save
```

响应：`[CodeUnit, ...]`（Set，无序）

#### `GET /api/v1/graph/subtypes` — 子类型查询

```
GET /api/v1/graph/subtypes?target=com.example.BaseService
```

响应：`[CodeUnit, ...]`

#### `GET /api/v1/graph/entrypoints` — 入口点列表

```
GET /api/v1/graph/entrypoints?projectId=abc123def456&lang=java
```

| 参数 | 必需 | 说明 |
|------|------|------|
| `projectId` | 否 | 12 字符 projectId 前缀。省略时返回所有已加载项目的入口点（跨项目混合，谨慎使用） |
| `lang` | 否 | `java` / `c` / `python`，省略返回全部语言 |

响应：`[CodeUnit, ...]`。仅返回 `metadata.is_entry_point=true` 的单元（框架注解或 C `main` 启发式标记）。

---

### 6.5 其他

#### `GET /api/v1/health` — 健康检查

```json
{ "status": "ok", "qdrant": "ok", "ollama": "ok" }
```

#### `GET /api/v1/sbom/{projectId}` — SBOM

```
GET /api/v1/sbom/a1b2c3d4e5f6?format=cyclonedx
```

`projectId` 是 projectRoot 路径的 SHA-256 前 12 位，可从索引状态响应中获取。

#### `GET /api/v1/frameworks/{projectId}` — 框架检测

返回项目中检测到的框架注解统计。

#### `GET /api/v1/projects` — 已索引项目列表

返回当前 Neo4j 中所有 `:Project` 元节点的概要：`projectId / projectRoot / nodeCount / indexedAt`。供 dashboard 项目选择器和 CLI 自动补全使用。

#### `GET /api/v1/projects/{projectId}/stats` — 项目聚合统计

返回 dashboard "统计" 面板使用的单项目聚合数据：`totalUnits / totalFiles / totalEdges / entryPointCount / testCount`，以及按 `kind / language / framework / edge type` 的分布 Map（key 为枚举名或框架名，value 为计数，按降序）。项目不存在时 HTTP 200 + 零计数。

#### `DELETE /api/v1/index/project?projectId=...` — 删除项目索引

清理指定项目的 Neo4j 节点、Qdrant 向量和 SQLite 增量缓存。不可撤销。

---

## 7. MCP 服务器

RepoGraph 内置 MCP（Model Context Protocol）stdio 服务器，让 Cursor 等支持 MCP 协议的 AI 工具直接查询代码知识图谱。

### 7.1 构建与启动

```bash
./gradlew :repograph-mcp:bootJar

# 前提：repograph-app 已在 8080 端口运行
java -jar repograph-mcp/build/libs/repograph-mcp-*.jar
```

MCP 服务器通过 stdin/stdout 与 AI 客户端通信，日志写入 `~/.repograph/mcp.log`。

### 7.2 配置

```properties
# repograph-mcp/src/main/resources/application.properties
repograph.base-url=http://localhost:8080   # repograph-app 地址
repograph.timeout-seconds=30
```

也可通过环境变量覆盖：

```bash
REPOGRAPH_BASE_URL=http://192.168.1.100:8080 java -jar repograph-mcp.jar
```

### 7.3 MCP 客户端集成

在 MCP 客户端配置（`mcpServers` 格式）中添加：

```json
{
  "mcpServers": {
    "repograph": {
      "command": "java",
      "args": ["-jar", "/path/to/repograph-mcp.jar"],
      "env": {
        "REPOGRAPH_BASE_URL": "http://localhost:8080"
      }
    }
  }
}
```

### 7.4 MCP 工具参考

共 **8 个工具**：

| 工具名 | 用途 | 必填参数 |
|--------|------|---------|
| `search_semantic` | 自然语言搜代码 | `query` |
| `search_code` | 代码片段找相似实现 | `snippet` |
| `lookup_symbol` | 精确查找符号（含源码） | `qualified_name` |
| `locate_at` | file:line → 符号名 | `file`, `line` |
| `find_callers` | 谁调用了 X | `target` |
| `find_callees` | X 调用了谁 | `target` |
| `get_impact` | X 变更后影响哪些代码 | `target` |
| `find_subtypes` | 谁实现/继承了 X | `target` |

#### 工具详情

**`search_semantic`**

```json
{
  "query": "HTTP 请求处理入口",
  "lang": "java",          // 可选：java / c / python
  "kind": "METHOD",        // 可选：METHOD / CLASS / FUNCTION / INTERFACE 等
  "limit": 10              // 可选，默认 10，最大 50
}
```

**`find_callers` / `find_callees`**

```json
{
  "target": "com.example.UserService#findById(Long)",
  "depth": 2   // 可选，默认 1（callers 默认 1），最大 5
}
```

**`locate_at`**

```json
{
  "file": "src/main/java/com/example/UserService.java",
  "line": 42
}
```

#### 典型 Agent 使用流程

```
用户: 帮我分析修改 UserService#save 的影响范围

AI 调用:
  1. get_impact("com.example.UserService#save")
     → 返回 15 个受影响单元

  2. lookup_symbol("com.example.UserService#save")
     → 返回完整签名和源码

  3. find_callees("com.example.UserService#save", depth=2)
     → 返回它调用的组件（Repository、Validator 等）
```

---

## 8. Dashboard 使用指南

启动服务后访问 `http://localhost:8080`，使用内置单页仪表盘。

### 8.1 界面布局

```
┌─────────────────────────────────────────────┐
│  ▣ RepoGraph  RepoGraph    [Qdrant] [Ollama] [中/EN] │  ← 顶部状态栏
├──┬──────────────────────────────────────────┤
│  │                                          │
│🔍│  当前面板内容区                           │
│📊│                                          │  ← 主内容区
│⬆ │                                          │
│♥ │                                          │
│  │                                          │
└──┴──────────────────────────────────────────┘
```

左侧竖向导航栏包含 4 个面板：搜索（1）、图谱（2）、索引（3）、健康（4）。

### 8.2 面板切换

| 方式 | 操作 |
|------|------|
| 鼠标点击 | 点击左侧导航图标 |
| 数字键 | `1` 搜索、`2` 图谱、`3` 索引、`4` 健康 |
| 快捷键 | `⌘K` 或 `/` 直接聚焦搜索框 |

### 8.3 搜索面板

1. 选择搜索模式（**语义** / **代码**）
2. 在搜索框输入查询，支持：
   - 自然语言：`"查找所有用户认证逻辑"`
   - 代码片段：`"void process(Request req, Response resp)"`
3. 可选过滤：语言 / 符号类型 / 返回数量

**键盘操作**

| 按键 | 效果 |
|------|------|
| `Enter` | 立即搜索 |
| `↓` | 聚焦到搜索历史或结果列表 |
| `↑` / `↓` | 在结果列表间导航 |
| `Enter`（选中结果时） | 在图谱面板中以该符号为目标查询 |
| `⌘C`（选中结果时） | 复制该符号全限定名 |
| `Esc` | 返回搜索框 |

**结果卡片操作**

- 单击卡片 → 在图谱面板查询该符号
- 点击 **查看源码** → 展开/折叠源代码预览
- 点击复制图标 → 复制全限定名（底部 Toast 确认）
- 搜索历史自动保存到 localStorage（最多 8 条）

### 8.4 图谱面板

1. 在 **目标符号** 输入框填入全限定名（从搜索面板点击结果可自动填入）
2. 选择查询类型：

| 模式 | 方向 | 说明 |
|------|------|------|
| ↑ 调用方 | 入边 | 谁调用了该符号 |
| ↓ 被调用 | 出边 | 该符号调用了谁 |
| ◎ 影响面 | 传递入边 | 变更后受影响的所有代码 |
| ⬦ 子类型 | 继承入边 | 谁继承/实现了该类型 |

3. 调整**深度**滑块（1–5，仅调用方/被调用模式生效）
4. 点击 **查询图谱**（或 `⌘Enter`）

**图谱交互**

| 操作 | 效果 |
|------|------|
| 单击节点 | 在左侧面板显示节点详情（类型、全名、文件、行号） |
| 双击节点 | 以该节点为新目标重新查询 |
| 拖拽节点 | 移动节点位置 |
| 滚轮 / 双指 | 缩放 |
| `+` / `−` / `⌂` 按钮 | 放大 / 缩小 / 重置视图 |

### 8.5 索引面板

1. 填写**项目根目录**（会保存到 localStorage）
2. 选择语言和解析策略
3. 可选开启**强制重建索引**（禁用增量缓存）
4. 点击**开始索引**（按钮在运行期间禁用，防止重复触发）

右侧状态区显示进度环、统计指标（文件数/单元数/边数/降级数/错误数/耗时）和实时日志。

### 8.6 健康面板

实时显示 Qdrant 和 Ollama 的连接状态（每 5 秒自动刷新，标签页隐藏时暂停轮询）。

---

## 9. 核心概念

### 9.1 全限定名（Qualified Name）格式

RepoGraph 使用统一的全限定名格式标识所有代码符号：

| 语言 | 示例 |
|------|------|
| Java 类 | `com.example.Foo` |
| Java 内部类 | `com.example.Foo$Bar` |
| Java 方法 | `com.example.Foo#bar(String,int)` |
| Java 构造器 | `com.example.Foo#Foo(String)` |
| Java 字段 | `com.example.Foo.name` |
| C 函数 | `parse_request` |
| Python 类 | `MyClass` |
| Python 方法 | `MyClass#my_method` |

> **注意**：在 URL 中使用时，`#` 需编码为 `%23`。

### 9.2 解析策略

| 策略 | 触发条件 | 精度 |
|------|---------|------|
| `PRECISE` | 强制使用 AST 解析器（Java/C/Python） | 高 |
| `HEURISTIC` | 强制使用启发式正则解析 | 中 |
| `AUTO`（推荐） | 先精确，解析失败/空结果则降级启发式 | 高（降级容错） |

降级后的文件会在索引状态的 `degradedFiles` 中记录。

### 9.3 边类型（EdgeKind）

| 边类型 | 方向 | 含义 |
|--------|------|------|
| `CONTAINS` | 类 → 方法/字段 | 包含关系 |
| `CALLS` | 方法A → 方法B | 调用关系 |
| `IMPORTS` | 文件A → 文件B/模块 | 导入关系 |
| `EXTENDS` | 子类 → 父类 | 继承关系 |
| `IMPLEMENTS` | 实现类 → 接口 | 接口实现关系 |
| `DEFINES_TYPE` | 方法 → 参数类型/返回类型 | 类型依赖 |
| `OVERRIDES` | 子类方法 → 父类方法 | 方法覆写 |

**各语言边支持矩阵**

| 边类型 | Java | C | Python |
|--------|:----:|:--:|:------:|
| CONTAINS | ✓ | ✓ | ✓ |
| CALLS | ✓ | ✓ | ✓ |
| IMPORTS | ✓ | ✓ | ✓ |
| EXTENDS | ✓ | — | ✓ |
| IMPLEMENTS | ✓ | — | — |
| DEFINES_TYPE | ✓ | — | — |
| OVERRIDES | ✓ | — | — |

### 9.4 projectId

每个项目由其根目录的绝对路径的 SHA-256 前 12 位唯一标识：

```bash
# 手动计算
echo -n "/path/to/project" | sha256sum | cut -c1-12
```

---

## 10. 已知局限

### 10.1 Java 解析

| 局限 | 说明 |
|------|------|
| 无完整 classpath | 外部库的方法调用标记 `resolved=false`，不影响同项目解析 |
| Lombok 生成代码 | `@Builder`、`@Getter` 等生成的方法不在图中 |
| 反射调用 | `Method.invoke()` 等动态调用无法静态追踪 |
| 跨文件链式调用 | `a.getB().doC()` 中若 `getB()` 在其他文件，`doC()` 的目标不可解析 |
| `super()` 构造器委托 | 父类构造器调用暂不产出 CALLS 边 |

### 10.2 Python 解析

| 局限 | 说明 |
|------|------|
| 动态类型 | `obj.method()` 若 `obj` 非 `self/cls`，不产出 CALLS 边（类型未知） |
| 相对导入 | `from . import foo` 的路径解析依赖 projectRoot 配置 |
| 元类 | 元类产出的方法不在图中 |

### 10.3 C 解析

| 局限 | 说明 |
|------|------|
| 宏展开 | 宏定义的函数调用可能漏检 |
| 函数指针 | 通过指针的间接调用不追踪 |

### 10.4 图谱

| 局限 | 说明 |
|------|------|
| 外部服务依赖 | 图存储托管在 Neo4j，repograph serve 无法连接 Neo4j 时图相关接口不可用 |
| 无时序语义 | 所有边无时间信息，不区分初始化/销毁顺序 |

### 10.5 审核队列

| 局限 | 说明 |
|------|------|
| PDF 无视觉回归 | `export?format=pdf` 已可用（内嵌 Noto Sans SC）；测试仅做 PDFBox 文本抽取断言，未做像素级视觉回归 |
| 无批量导出 | 一次只能导出单个快照，尚不支持跨快照批量打包 |
| 无认领超时释放 | 长期 `IN_REVIEW` 且无人跟进的条目不会自动退回 `PENDING` |
| 无分页 | `GET /api/v1/review-queue` 一次返回全部匹配条目 |

---

## 11. 故障排查

### 图查询返回空

1. 运行 `GET /api/v1/health` 确认服务正常
2. 确认项目已完成索引（`GET /api/v1/index/project/status`）
3. 在 Neo4j 浏览器（`http://localhost:7474`）执行 `MATCH (n:CodeUnit) RETURN count(n)` 确认节点数量
4. 若节点数为 0，触发一次完整索引（`POST /api/v1/index/project`）

### Embedding 超时

```
repograph.ollama.timeout-seconds=600
repograph.index.batch-size.embed=4
```

降低批次大小并延长超时。

### Qdrant 连接失败

```bash
# 检查容器状态
docker ps | grep qdrant
# 检查端口
curl http://localhost:16333/healthz
```

确认 gRPC 端口（16334）已暴露，而非仅 HTTP 端口。

### Tree-sitter native 库不可用

Python/C 解析依赖 native 库。若日志出现 `Tree-sitter Python native library failed to load`：

1. 确认 Java 版本 ≥ 22（FFM API）
2. 检查 `--enable-native-access=ALL-UNNAMED` JVM 参数（项目已在 Gradle 中配置）
3. C/Python 文件将自动降级到启发式解析

### MCP 服务器无响应

```bash
# 查看日志
tail -f ~/.repograph/mcp.log

# 确认 repograph-app 已启动
curl http://localhost:8080/api/v1/health
```

MCP 所有输出重定向到日志文件，stdout 保持洁净供 JSON-RPC 使用。

---

*RepoGraph RepoGraph · [GitHub](https://github.com) · 问题反馈请提 Issue*

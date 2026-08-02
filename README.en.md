<div align="right">

[中文](README.md)

</div>

<div align="center">
  <img src="repograph-app/src/main/resources/static/img/logo.png" alt="RepoGraph" width="200"/>
</div>

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Java 25](https://img.shields.io/badge/Java-25-blue.svg)](https://openjdk.org/)

</div>

# RepoGraph

> **Local-first code knowledge graph** — semantic search, call chain analysis, security-aware GraphRAG, taint analysis, and vulnerability scanning. Fully offline. MCP-native.

RepoGraph indexes your source code into a graph + vector database running entirely on your machine. No code leaves your network. Built for private codebases and air-gapped environments.

**Parsed sources**: Java · C · Python · Markdown docs · Java bytecode (optional)  
**Storage backends**: [Qdrant](https://qdrant.tech/) (vector) · [Neo4j](https://neo4j.com/) (graph) · [Ollama](https://ollama.ai/) (embeddings) · SQLite (incremental cache)

---

## Positioning

RepoGraph's end goal is to be a **context provider for LLM agents**: let an agent locate the right context on demand inside a large codebase through tool calls, instead of stuffing the whole repo into a context window. The MCP toolset + GraphRAG retrieval are the core deliverables.

The current phase ships as a **standalone code-audit platform** — every analysis capability is built and validated on the platform first (web console / REST), then exposed as MCP tools step by step (see [Roadmap](#roadmap)).

**Scope boundary**: static heuristic analysis, not full compiler semantics — coarse-to-medium granularity is enough for retrieval and auditing; the WALA IFDS precise taint engine covers the cases that demand maximum precision. Fully local; code never leaves your network.

---

## Features

| Domain | Capability | Details |
|--------|-----------|---------|
| Parsing | Java | Full AST — types, methods, fields, annotations, call edges |
| Parsing | C / Python | Tree-sitter; graceful fallback to heuristic parsing |
| Parsing | Bytecode | Optional `.class` analysis |
| Parsing | Markdown docs | H1–H3 sections become DOCUMENT units, searchable via semantic search |
| Indexing | Incremental | File-level cache; only modified files reprocessed |
| Indexing | File watching | Auto-triggered on create / modify / delete |
| Indexing | Multi-project | Per-project isolation with stable IDs, stats, and delete |
| Vector search | Semantic | Natural language → code units |
| Vector search | Code similarity | Code snippet → similar implementations |
| GraphRAG | Call graph retrieval | Vector seeds → call graph expansion (callers + callees) |
| GraphRAG | Impact expansion | Impact analysis narrowed to security-relevant nodes |
| GraphRAG | Security-aware rerank | Static signal scoring across auth, SQL, crypto, exec patterns; no LLM |
| Graph | Call chain | Configurable-depth caller / callee traversal |
| Graph | Impact analysis | Transitive impact across calls, inheritance, and overrides |
| Graph | Type hierarchy | Subtype queries for classes and interfaces |
| Flow analysis | CFG | On-demand control-flow graph per method / constructor |
| Flow analysis | PDG | Data and control dependency graph |
| Flow analysis | Data flow summary | Parameter → return and field read / write summaries |
| Flow analysis | Interprocedural taint | Per-method summaries + BFS along the call graph; built-in SQL / OS / deserialization sinks |
| Framework | Entry points | Spring MVC, JAX-RS, MyBatis — marks `is_entry_point` |
| SBOM | Maven | `pom.xml` → CycloneDX JSON (`pkg:maven`) |
| SBOM | Gradle | `build.gradle[.kts]` + `libs.versions.toml` → CycloneDX JSON (`pkg:maven`) |
| SBOM | npm | `package.json` → CycloneDX JSON (`pkg:npm`); scoped packages supported |
| SBOM | pip | `pyproject.toml` + `requirements*.txt` → CycloneDX JSON (`pkg:pypi`) |
| Vulnerability | Code scanning | 9 CWE-tagged rules: SQL/command injection, XXE, weak crypto, hardcoded secrets, path traversal, unsafe deserialization, insecure random, sensitive logging |
| Vulnerability | Taint scanning | Interprocedural taint tracking (HTTP entry point → sink, source-level heuristic) |
| Vulnerability | Precise taint scanning | WALA IFDS bytecode-level field-sensitive analysis (standalone engine process) |
| Vulnerability | Dependency scanning | Offline CVE advisory — 80 CVEs across major Java libraries |
| Vulnerability | Impact analysis | Graph traversal from a finding to all reachable callers |
| Vulnerability | Status management | `SUSPECTED → CONFIRMED → FIXED / DISMISSED` state machine |
| Quality | Code metrics | Cyclomatic complexity, coupling / instability, package cycles (Tarjan SCC), git churn hotspots |
| Quality | Health report | Six-dimension score aggregating vulnerabilities, cycles, complexity, test gaps, dead code |
| Visualization | Dependency graph export | Package-level dependency graph → DOT / Mermaid, cycles highlighted |
| AI integration | MCP server | 23 stdio MCP tools — search / GraphRAG / call graph / taint / vulns / indexing |
| UI | Web console | Search, graph, flow analysis, vulnerability panel, stats, indexing, health — at `localhost:8080` |

---

## Screenshots

**Semantic Search** — natural language query across the entire codebase

![Semantic Search](docs/screenshots/01-semantic-search.png)

**Code Graph** — call chain, impact analysis, dead code, and type hierarchy

![Code Graph – Callers](docs/screenshots/02-graph-callers.png)

**Flow Analysis** — on-demand CFG and PDG per Java method

![Flow Analysis – CFG](docs/screenshots/05-flow-cfg.png)

**Vulnerability Panel** — code scanning, dependency CVEs, and impact chains

![Vulnerability Panel](docs/screenshots/07-vuln-panel.png)

---

## Architecture

```
┌─────────────────────────────────┐    ┌──────────────────┐
│        repograph-app            │    │  repograph-mcp   │
│  Spring Boot Web + REST API     │◄───│  MCP stdio server│
│                                 │    │  (AI tool bridge)│
│  Parser  ──► Graph ──► Vector   │    └──────────────────┘
│  (Java/C/Python)  Neo4j  Qdrant │
└────────┬───────────────┬────────┘
         │               │ subprocess (JSON I/O)
         │               ▼
         │      ┌──────────────────────────┐
         │      │  repograph-taint-engine  │
         │      │  WALA IFDS precise taint │
         │      │  (experimental module;   │
         │      │   runs on a jmods JDK)   │
         │      └──────────────────────────┘
         ▼  External services (Docker Compose provided)
┌────────────────────────────────────────────────┐
│  Qdrant :16333/:16334   Neo4j :7474/:7687      │
│  Ollama :11434          SQLite ~/.repograph/    │
└────────────────────────────────────────────────┘
```

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Docker** | For Qdrant and Neo4j |
| **JDK 25** | Required for stable FFM API (Tree-sitter). [Temurin 25](https://adoptium.net/) recommended |
| **Ollama** | Self-hosted embedding model. Install from [ollama.ai](https://ollama.ai/) |

Pull the embedding model (one-time, ~7.5 GB):

```bash
ollama pull manutic/nomic-embed-code
```

---

## Quick Start

**1. Start infrastructure**

```bash
docker compose up -d
```

Starts Qdrant (`:16333`/`:16334`) and Neo4j (`:7474`/`:7687`). Ollama runs separately on your host.

**2. Build**

```bash
./gradlew :repograph-app:bootJar -x test
```

**3. Start the server and index a project**

```bash
# Start the REST server
java --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.5.0.jar

# In another terminal — index your project asynchronously through REST
curl -X POST "http://localhost:8080/api/v1/index/project" \
  -H "Content-Type: application/json" \
  -d '{"projectRoot":"/path/to/your/project"}'
```

Open **http://localhost:8080** for the web console.

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/index/project` | Start indexing (async, returns 202) |
| `GET` | `/api/v1/index/project/status` | Poll indexing progress |
| `POST` | `/api/v1/index/file` | Index a single file |
| `DELETE` | `/api/v1/index/project` | Remove project index |
| `GET` | `/api/v1/search/semantic` | Natural language semantic search |
| `GET` | `/api/v1/search/code` | Code snippet similarity search |
| `GET` | `/api/v1/search/graphrag` | GraphRAG (vector + call graph + impact + rerank) |
| `GET` | `/api/v1/symbol/{qualifiedName}` | Symbol details |
| `GET` | `/api/v1/locate` | Resolve file + line to symbol |
| `GET` | `/api/v1/graph/callers` | Find callers |
| `GET` | `/api/v1/graph/callees` | Find callees |
| `GET` | `/api/v1/graph/impact` | Impact analysis |
| `GET` | `/api/v1/graph/subtypes` | Subclasses and implementations |
| `GET` | `/api/v1/graph/entrypoints` | Framework entry points |
| `GET` | `/api/v1/flow/analyze` | On-demand CFG / PDG / data flow |
| `GET` | `/api/v1/flow/taint` | Interprocedural taint trace (source method → sink) |
| `GET` | `/api/v1/metrics/complexity` | Cyclomatic complexity ranking |
| `GET` | `/api/v1/metrics/coupling` | Coupling / instability analysis |
| `GET` | `/api/v1/metrics/cycles` | Package cycle detection |
| `GET` | `/api/v1/metrics/hotspots` | Git churn hotspots |
| `GET` | `/api/v1/metrics/report` | Code health report (6 dimensions + score) |
| `GET` | `/api/v1/export/graph` | Package dependency graph export (DOT / Mermaid) |
| `GET` | `/api/v1/projects` | List indexed projects |
| `GET` | `/api/v1/projects/{projectId}/stats` | Project statistics |
| `GET` | `/api/v1/sbom/{projectId}` | Generate SBOM |
| `POST` | `/api/v1/vulns/scan/code` | Trigger code vulnerability scan |
| `POST` | `/api/v1/vulns/scan/taint` | Trigger taint vulnerability scan (source-level heuristic) |
| `POST` | `/api/v1/vulns/scan/taint/precise` | Trigger precise taint scan (WALA IFDS engine) |
| `POST` | `/api/v1/vulns/scan/deps` | Trigger dependency vulnerability scan |
| `GET` | `/api/v1/vulns` | List vulnerability findings |
| `PUT` | `/api/v1/vulns/{id}/status` | Update finding status |
| `GET` | `/api/v1/vulns/{id}/impact` | Vulnerability impact analysis |
| `GET` | `/api/v1/vulns/report/{projectId}` | Vulnerability report (JSON) |
| `GET` | `/api/v1/health` | Health check |

---

## MCP Integration

RepoGraph ships a standalone MCP stdio server (`repograph-mcp`) for direct integration with Cursor and any other MCP-compatible AI tool.

Add to your MCP client configuration (`mcpServers` format):

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

**Available MCP tools:**

| Tool | Description |
|------|-------------|
| `search_semantic` | Natural language code search |
| `search_code` | Code snippet similarity search |
| `search_graphrag` | GraphRAG search (vector + call graph + impact + security rerank) |
| `lookup_symbol` | Full symbol details by qualified name |
| `locate_at` | File + line → symbol name |
| `find_callers` | Find callers (configurable depth) |
| `find_callees` | Find callees (configurable depth) |
| `get_impact` | Transitive impact analysis |
| `find_subtypes` | Subclasses and interface implementations |
| `find_entrypoints` | Framework entry points |
| `analyze_flow` | Per-method data flow summary / CFG / PDG |
| `trace_taint` | Interprocedural taint trace (source method → sink) |
| `scan_vuln_code` | Trigger code vulnerability scan |
| `list_vulns` | List vulnerability findings (with filters) |
| `list_projects` | List indexed projects |
| `get_health_report` | Code health report (6 dimensions + score) |
| `trigger_index` | Trigger project indexing (async) |
| `index_status` | Poll indexing progress |

---

## GraphRAG Pipeline

`GET /api/v1/search/graphrag` fuses four stages into a single call:

```
Natural language query
  └─ 1. Code Structure Chunking  (index-time: 3-layer semantic text per method)
       └─ 2. Call Graph Retrieval (vector seeds → callers + callees expansion)
            └─ 3. Impact Expansion (impact analysis, security-relevant nodes only)
                 └─ 4. Security-aware Rerank (static signal scoring + finalScore)
```

**Security scoring signals:**

| Signal | Score | Trigger |
|--------|-------|---------|
| Auth method names | +0.3 | Auth / permission method names |
| Security annotations | +0.3 | Security framework annotations |
| Direct SQL execution | +0.3 | SQL execution call sites |
| Command execution | +0.3 | OS command execution call sites |
| Deserialization | +0.3 | Deserialization method names |
| Crypto operations | +0.2 | Crypto operation names |
| Input validation | +0.2 | Input validation method names |
| Sensitive field names | +0.2 | Sensitive field / parameter names |
| HTTP entry annotations | +0.1 | HTTP entry annotations |
| Framework entry points | +0.1 | `is_entry_point=true` |

`finalScore = vectorScore + 0.5 × securityScore`

---

## Configuration

Edit `repograph-app/src/main/resources/application.yml`:

```yaml
repograph:
  qdrant:
    host: localhost
    port: 16334                   # gRPC port (Docker: host 16334 → container 6334)
    collection: code_units
    vector-size: 3584             # manutic/nomic-embed-code output dimension
  ollama:
    base-url: http://localhost:11434
    model: manutic/nomic-embed-code
    timeout-seconds: 300          # 7.5 GB model; keep high for large batches
  neo4j:
    uri: bolt://localhost:7687
    user: neo4j
    password: neo4jneo4j
  index:
    batch-size:
      embed: 8                    # Reduce if Ollama times out
      upsert: 256
    default-strategy: AUTO        # auto | precise | heuristic
  taint:
    precise:                      # Precise taint scan (WALA IFDS engine, separate process)
      enabled: false              # Enable after setting java-home and engine-lib-dir
      java-home: ""               # JDK home with jmods (e.g. JDK 21)
      engine-lib-dir: ""          # lib dir from :repograph-taint-engine:installDist
      timeout-seconds: 600
```

---

## Building from Source

```bash
# Build all modules (skip tests for speed)
./gradlew build -x test

# Run unit tests (no external services needed)
./gradlew test --tests "!*IT"

# Run full test suite (requires Qdrant + Neo4j + Ollama)
./gradlew test

# Retrieval quality benchmark (index repograph-app first)
./gradlew :repograph-app:test --tests "*.benchmark.*"
```

**Build outputs:**
- `repograph-app/build/libs/repograph-app-0.5.0.jar` — Web / REST server
- `repograph-mcp/build/libs/repograph-mcp-exec.jar` — MCP stdio server
- `./gradlew :repograph-taint-engine:installDist` — precise taint engine (`build/install/repograph-taint-engine/`, invoked as a subprocess by the precise scan)

> **Note:** JDK 25 is required for the app. The `--enable-native-access=ALL-UNNAMED` flag is set automatically via `gradle.properties`. The taint engine builds and runs on JDK 21 (its Gradle toolchain downloads it if missing); at runtime the precise scan needs a JDK that ships `jmods` (JDK 17/21 do, JDK 25 does not).

---

## Roadmap

### Vision

RepoGraph is built toward a single goal: **let an LLM act as an agent and locate the right context on demand inside a large codebase** — without stuffing the whole repo into a context window.

The path there is two-phased:

```
Phase 1 (current)   Standalone code-audit platform
                    Build and validate all analytical capabilities here.

Phase 2 (next)      LLM-agent context provider
                    Expose the validated capabilities as MCP tools;
                    let the agent query the knowledge graph iteratively.
```

### Phase 1 — Audit Platform ✓

Everything in the [Features](#features) table is implemented and available today via the web console, REST API, and MCP.

### Phase 2 — LLM Agent Integration (in progress)

Done:

| Item | Description |
|------|-------------|
| `search_graphrag` MCP tool ✓ | The 4-stage GraphRAG pipeline (vector → call graph → impact → rerank) is exposed as an MCP tool |
| Security MCP tools ✓ | `trace_taint` / `list_vulns` / `scan_vuln_code` / `list_projects` |
| Agent orientation tools ✓ | `get_health_report` / `trigger_index` / `index_status` — the agent can check index state and trigger indexing itself |
| Precise taint engine ✓ | `repograph-taint-engine` (WALA IFDS) integrated as a separate process — the fourth scanning path |

Next:

| Item | Description |
|------|-------------|
| `rawSource` in tool results | MCP tools return metadata only; adding source text lets the agent read a method body without a separate file lookup |
| Cross-project call resolution | Better call-edge linking across sub-projects inside a monorepo |
| More language support | Go (`go.mod` SBOM; Tree-sitter parsing) |

---

## Known Limitations

- Without a full classpath, call resolution fails for external library methods
- Lombok / annotation-processor generated code is unreliable
- Reflection and dynamic proxy calls cannot be statically traced
- C preprocessor macro expansion is not performed; conditional compilation is not build-config-aware
- C function pointer calls cannot be precisely resolved
- Flow analysis: Java gets CFG + PDG + taint summaries (precise AST); C / Python get CFG + conservative data-flow summaries only. Data dependencies are conservative heuristics, not SSA
- Precise taint scanning requires compiled classes / jars and a JDK that ships `jmods` (JDK 17/21 work; JDK 25 does not include them)

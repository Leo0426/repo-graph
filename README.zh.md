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

> **Local-first code knowledge graph** — semantic search, call chain analysis, security-aware GraphRAG, and vulnerability scanning. Fully offline. MCP-native.

RepoGraph indexes your source code into a graph + vector database running entirely on your machine. No code leaves your network. Built for private codebases and air-gapped environments.

**Supported languages**: Java · C · Python  
**Storage backends**: [Qdrant](https://qdrant.tech/) (vector) · [Neo4j](https://neo4j.com/) (graph) · [Ollama](https://ollama.ai/) (embeddings) · SQLite (incremental cache)

---

## Features

| Domain | Capability | Details |
|--------|-----------|---------|
| Parsing | Java | Full AST — types, methods, fields, annotations, call edges |
| Parsing | C / Python | Tree-sitter; graceful fallback to heuristic parsing |
| Parsing | Bytecode | Optional `.class` analysis |
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
| Framework | Entry points | Spring MVC, JAX-RS, MyBatis — marks `is_entry_point` |
| SBOM | Maven | `pom.xml` → CycloneDX JSON (`pkg:maven`) |
| SBOM | Gradle | `build.gradle[.kts]` + `libs.versions.toml` → CycloneDX JSON (`pkg:maven`) |
| SBOM | npm | `package.json` → CycloneDX JSON (`pkg:npm`); scoped packages supported |
| SBOM | pip | `pyproject.toml` + `requirements*.txt` → CycloneDX JSON (`pkg:pypi`) |
| Vulnerability | Code scanning | 9 CWE-tagged rules: SQL/command injection, XXE, weak crypto, hardcoded secrets, path traversal, unsafe deserialization, insecure random, sensitive logging |
| Vulnerability | Dependency scanning | Offline CVE advisory — 80 CVEs across major Java libraries |
| Vulnerability | Impact analysis | Graph traversal from a finding to all reachable callers |
| Vulnerability | Status management | `SUSPECTED → CONFIRMED → FIXED / DISMISSED` state machine |
| AI integration | MCP server | stdio MCP server — plug into Claude Desktop, Cursor, and any MCP client |
| UI | Web console | Search, graph, flow analysis, stats, indexing, health — at `localhost:8080` |

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
│  Spring Boot REST API + CLI     │◄───│  MCP stdio server│
│                                 │    │  (AI tool bridge)│
│  Parser  ──► Graph ──► Vector   │    └──────────────────┘
│  (Java/C/Python)  Neo4j  Qdrant │
└────────┬────────────────────────┘
         │
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

**3. Index a project and start the server**

```bash
# Start the REST server
java --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.5.0.jar serve

# In another terminal — index your project
java --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.5.0.jar \
  index /path/to/your/project
```

Open **http://localhost:8080** for the web console.

---

## CLI Reference

```
repograph index <projectRoot>        Scan and build vector index + knowledge graph
repograph search <query>             Semantic search (natural language)
repograph symbol <qualifiedName>     Show symbol details
repograph locate <file> <line>       Resolve line number to symbol
repograph callers <symbol>           Find callers (with depth)
repograph callees <symbol>           Find callees (with depth)
repograph impact <symbol>            Transitive impact analysis
repograph subtypes <type>            Find subclasses and interface implementations
repograph entrypoints                List framework entry points
repograph projects                   List indexed projects
repograph stats <projectId>          Project statistics
repograph sbom <projectId>           Generate SBOM (CycloneDX JSON) — auto-detects Maven / Gradle / npm / pip
repograph delete <projectRoot>       Remove project index
repograph watch <projectRoot>        Watch for file changes and auto-reindex
repograph serve                      Start REST server
repograph vuln scan-code <projectId>             Scan for code vulnerabilities
repograph vuln scan-deps <projectId> <root>      Scan dependencies against advisory DB
repograph vuln list <projectId>                  List vulnerability findings
repograph vuln report <projectId> [--out FILE]   Generate vulnerability report
```

Common `index` options:

```
--lang java,c,python    Target languages (default: all)
--strategy auto         Parse strategy: auto / precise / heuristic
--no-incremental        Force full reindex
```

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
| `GET` | `/api/v1/projects` | List indexed projects |
| `GET` | `/api/v1/projects/{projectId}/stats` | Project statistics |
| `GET` | `/api/v1/sbom/{projectId}` | Generate SBOM |
| `POST` | `/api/v1/vulns/scan/code` | Trigger code vulnerability scan |
| `POST` | `/api/v1/vulns/scan/deps` | Trigger dependency vulnerability scan |
| `GET` | `/api/v1/vulns` | List vulnerability findings |
| `PUT` | `/api/v1/vulns/{id}/status` | Update finding status |
| `GET` | `/api/v1/vulns/{id}/impact` | Vulnerability impact analysis |
| `GET` | `/api/v1/vulns/report/{projectId}` | Vulnerability report (JSON) |
| `GET` | `/api/v1/health` | Health check |

---

## MCP Integration

RepoGraph ships a standalone MCP stdio server (`repograph-mcp`) for direct integration with Claude Desktop, Cursor, and other MCP-compatible AI tools.

Add to your `claude_desktop_config.json`:

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
| `lookup_symbol` | Full symbol details by qualified name |
| `locate_at` | File + line → symbol name |
| `find_callers` | Find callers (configurable depth) |
| `find_callees` | Find callees (configurable depth) |
| `get_impact` | Transitive impact analysis |
| `find_subtypes` | Subclasses and interface implementations |
| `find_entrypoints` | Framework entry points |

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
- `repograph-app/build/libs/repograph-app-0.5.0.jar` — REST server + CLI
- `repograph-mcp/build/libs/repograph-mcp-exec.jar` — MCP stdio server

> **Note:** JDK 25 is required. The `--enable-native-access=ALL-UNNAMED` flag is set automatically via `gradle.properties`.

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

Everything in the [Features](#features) table is implemented and available today via the web console, REST API, and CLI.

### Phase 2 — LLM Agent Integration

| Item | Description |
|------|-------------|
| `search_graphrag` MCP tool | Expose the 4-stage GraphRAG pipeline (vector → call graph → impact → rerank) as an MCP tool — currently only reachable via REST |
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
- Flow analysis (CFG/PDG) covers Java only; data dependencies are conservative heuristics, not SSA

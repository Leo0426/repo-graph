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

A local-first code knowledge graph and semantic analysis tool for static heuristic code analysis. Runs entirely on your machine — no code leaves your network.

- **Semantic / similarity search** — find implementations by natural language or code snippet; Markdown docs are searchable too
- **Code graph analysis** — call chains, impact analysis, type hierarchy, with receiver-type-aware call resolution
- **Flow analysis** — Java method-level CFG / PDG / data-flow summaries, interprocedural taint tracking
- **Vulnerability management** — code rules / dependency CVE / taint scanning as three complementary paths, findings gated by a state machine
- **Quality & SBOM** — cyclomatic complexity, coupling, package cycles, git hotspots, health score; Maven/Gradle/npm/pip → CycloneDX
- **AI integration** — MCP stdio server exposing GraphRAG / Context Pack / triage capabilities to coding agents

**Stack**: Java 25 (app) + Java 21 (precise taint engine), Spring Boot 3.x, Gradle (Kotlin DSL)
**Parsed sources**: Java / C / Python source + Markdown + Java bytecode (optional)
**Storage backends**: [Qdrant](https://qdrant.tech/) (vector) · [Neo4j](https://neo4j.com/) (graph) · [Ollama](https://ollama.ai/) (embeddings) · SQLite (incremental cache)

> Full usage details are in the **[User Manual](docs/user-manual.md)** (prerequisites / configuration / REST API / MCP tool reference — in Chinese).

---

## Positioning

RepoGraph's end goal is to be a **context provider for LLM agents**: let an agent locate the right context on demand inside a large codebase through tool calls, instead of stuffing the whole repo into a context window. The near-term product line converges on an **AI-native SAST triage agent for enterprise security teams** — ingesting results from CodeQL / Semgrep / SonarQube / SCA and turning alerts into explainable, verifiable, fixable triage reports.

The current phase ships as a **standalone code-audit platform**: every analysis capability is built and validated on the platform (web console / REST) first, then exposed as MCP tools step by step (see [Roadmap](#roadmap)).

**Scope boundary**: static heuristic analysis, not full compiler semantics — coarse-to-medium granularity is enough for retrieval and auditing; the WALA IFDS precise taint engine covers the cases that demand maximum precision.

---

## Highlights

- **Fully local, zero cloud** — parsing, embedding, and retrieval all happen on your machine; code never touches an external API. Built for private codebases and air-gapped networks.
- **GraphRAG in one call** — vector seeds + keyword seeds → call graph expansion → impact expansion → security-aware rerank, fused into a single API with no LLM in the loop.
- **Structured chunks, 3-layer semantic text** — class-level Javadoc/annotations + method Javadoc + method signature are stacked so natural-language queries hit private/package-level methods; separate semantic and code-similarity vectors don't interfere.
- **Incremental indexing** — file-level MD5 cache; changing one file rebuilds only that file. Million-line codebases update in seconds.
- **Framework-aware** — auto-detects Spring MVC / JAX-RS / MyBatis annotations and marks entry points, no manual tagging.
- **Three complementary vuln paths** — static rules (fast) + interprocedural taint (precise: source-level + WALA IFDS bytecode-level) + offline CVE; findings move through a confirmation state machine, fully offline.

---

## Features

| Domain | Capabilities |
| --- | --- |
| Parsing | Java (AST), C / Python (Tree-sitter, graceful fallback), Java bytecode (optional), Markdown docs (H1–H3 sections → DOCUMENT units) |
| Indexing | Incremental (file-level cache), file watching with auto-update, multi-project isolation |
| Vector search | Semantic search (NL → code), code similarity search (snippet → implementations) |
| GraphRAG | Hybrid seed recall (vector + keyword), keyword BM25-like search, call graph expansion, impact expansion, security-aware rerank |
| Symbol / code graph | Symbol details & locate, autocomplete, call chains, impact analysis, type hierarchy — all support `projectId` filtering |
| Flow analysis | Data-flow summaries, Java method-level CFG / PDG, interprocedural taint tracking |
| Framework | Spring MVC / JAX-RS / MyBatis entry-point detection and marking |
| Vulnerability | Code scanning (9 CWE rules), taint scanning, precise taint scanning (WALA IFDS), dependency CVE (offline advisory) |
| Quality metrics | Cyclomatic complexity / coupling / package cycles (Tarjan SCC) / git hotspots, six-dimension health report |
| SBOM | Maven / Gradle / npm / pip → CycloneDX JSON |
| Visualization | Web console (`http://localhost:8080`), package dependency graph export (DOT / Mermaid, cycles highlighted) |
| AI integration | MCP stdio server (`repograph-mcp`, 23 tools) |
| Quality eval | Retrieval benchmark (Hit@K, MRR@10, HitScore + threshold gate) |

> Flow analysis: Java supports CFG + PDG + taint summaries (precise AST); C / Python get CFG + conservative data-flow summaries only. Data dependencies are conservative heuristics, not SSA.
> Call entry points and parameters for each capability are in the [User Manual](docs/user-manual.md).

---

## Screenshots

| Semantic Search | Code Graph |
| --- | --- |
| ![Semantic Search](docs/screenshots/01-semantic-search.png) | ![Code Graph](docs/screenshots/02-graph-callers.png) |
| **Flow Analysis (CFG / PDG)** | **Vulnerability Panel** |
| ![Flow Analysis](docs/screenshots/05-flow-cfg.png) | ![Vulnerability Panel](docs/screenshots/07-vuln-panel.png) |

---

## Module Structure

Three Gradle sub-projects:

```
repograph-app/   Spring Boot web service (REST API, index pipeline, retrieval)
  ├─ core/        Domain model + interface definitions (CodeUnit / VectorStore / GraphQueryService)
  ├─ parser/      JavaParser AST, Tree-sitter FFM (C/Python), Markdown, heuristic state machine
  ├─ graph/       Neo4j Bolt facade (call chain / impact / inheritance)
  ├─ vector/      Qdrant gRPC (vectors) + Ollama (embeddings)
  ├─ flow/        Intra-procedural CFG / PDG / data-flow summaries + interprocedural taint
  ├─ retrieval/   GraphRAG + keyword recall + security-aware rerank + Context Pack
  ├─ framework/   Spring / JAX-RS / MyBatis annotation detection, entry-point marking
  ├─ sbom/        Maven / Gradle / npm / pip → CycloneDX JSON
  ├─ vuln/        Vulnerability scanning (code rules / taint / dependency CVE) + findings state machine
  ├─ metrics/     Cyclomatic complexity / coupling / package cycles / git hotspots / health report
  ├─ export/      Package-level dependency graph export (DOT / Mermaid)
  ├─ api/         Spring MVC REST controllers
  └─ app/         Index pipeline + Spring Boot entry point

repograph-mcp/          Standalone MCP stdio server (AI tool bridge, forwards to repograph-app over HTTP)
repograph-taint-engine/ WALA IFDS precise taint engine (separate process, JDK 21; see module README)
```

---

## Prerequisites

| Service | How to start |
|---------|--------------|
| **Qdrant** | `docker run -d -p 16333:6333 -p 16334:6334 qdrant/qdrant` |
| **Neo4j** | `docker run -d -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/neo4jneo4j neo4j:5` |
| **Ollama** | Run locally or remotely; pull the model `ollama pull manutic/nomic-embed-code` |
| **JDK 25** | Needs `--enable-native-access=ALL-UNNAMED` (Tree-sitter FFM); precise taint scanning additionally needs a JDK with jmods (e.g. JDK 21) |

---

## Quick Start

```bash
# 1. Build
./gradlew build -x test        # skip tests for a fast build

# 2. Start the REST server
java --enable-native-access=ALL-UNNAMED \
  -jar repograph-app/build/libs/repograph-app-0.5.0.jar

# 3. Index a project (async, returns 202; poll with the status endpoint)
curl -X POST "http://localhost:8080/api/v1/index/project" \
  -H "Content-Type: application/json" \
  -d '{"projectRoot": "/path/to/your/project"}'

# 4. Semantic search
curl "http://localhost:8080/api/v1/search/semantic?q=HTTP+REST+endpoint+handler&lang=java&limit=10"
```

Configuration lives in `repograph-app/src/main/resources/application.yml`; full field reference in [User Manual §4](docs/user-manual.md).

**Build outputs:**
- `repograph-app/build/libs/repograph-app-0.5.0.jar` — Web / REST server
- `repograph-mcp/build/libs/repograph-mcp-exec.jar` — MCP stdio server
- `./gradlew :repograph-taint-engine:installDist` — precise taint engine (invoked as a subprocess by the precise scan)

**Retrieval benchmark** (index first; Qdrant + Ollama online):

```bash
./gradlew :repograph-app:test --tests "*.benchmark.*"
# Metrics Hit@1/3/5/10, MRR@10, HitScore; test fails if Hit@10 is below threshold (semantic 65% / code 75%)
```

---

## REST API

Core endpoints below; the full list (vulnerabilities, assets, scanners, triage, …) is in [User Manual §5](docs/user-manual.md).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/index/project` | Start indexing (async, returns 202) |
| `GET` | `/api/v1/search/semantic` | Natural language semantic search |
| `GET` | `/api/v1/search/graphrag` | GraphRAG (vector + call graph + impact + security rerank) |
| `GET` | `/api/v1/context/pack` | Build a citation-backed agent context pack |
| `GET` | `/api/v1/graph/callers` `/callees` `/impact` `/subtypes` | Call graph queries |
| `GET` | `/api/v1/flow/analyze` `/flow/taint` | Flow analysis and interprocedural taint |
| `GET` | `/api/v1/metrics/report` | Code health report (6 dimensions + score) |
| `POST` | `/api/v1/vulns/scan/{code,taint,taint/precise,deps}` | Four vulnerability scanning paths |

---

## GraphRAG Retrieval

`GET /api/v1/search/graphrag` is the recommended entry point for high-quality code retrieval, fusing four stages into a single call with no LLM in the loop:

```
Natural language query
  └─ 1. Code Structure Chunking  (index-time: 3-layer semantic text)
       └─ 2. Call Graph Retrieval (vector/keyword seeds → callers + callees expansion)
            └─ 3. Impact Expansion (impact analysis, security-relevant nodes only)
                 └─ 4. Security-aware Rerank (static signal scoring + finalScore)
```

Security scoring weights static signals across entry points, auth, SQL/command execution, deserialization, and crypto: `finalScore = vectorScore + 0.5 × securityScore`. Parameters, response structure, and the full scoring table are in the [User Manual](docs/user-manual.md).

---

## MCP Integration

RepoGraph ships an MCP stdio server for Cursor and any other MCP-compatible AI tool.

```json
{
  "mcpServers": {
    "repograph": {
      "command": "java",
      "args": ["-jar", "/path/to/repograph-mcp-exec.jar", "--base-url", "http://localhost:8080"]
    }
  }
}
```

23 tools grouped by domain:

- **Retrieval** — `search_semantic` / `search_keyword` / `search_code` / `search_graphrag` / `build_context_pack`
- **Code graph** — `lookup_symbol` / `locate_at` / `find_callers` / `find_callees` / `get_impact` / `find_subtypes` / `find_entrypoints`
- **Flow / vulns** — `analyze_flow` / `trace_taint` / `scan_vuln_code` / `list_vulns` / `get_health_report`
- **SAST triage** — `triage_finding` (import Semgrep/SARIF/CodeQL and produce a triage report) / `record_triage_feedback` / `list_triage_feedback`
- **Project management** — `list_projects` / `trigger_index` / `index_status`

Tool parameters are documented in the [User Manual](docs/user-manual.md).

---

## Vulnerability Management

> **Status**: implemented (v0.5.0). Built on top of the GraphRAG security infrastructure, fully local, no network required.

Four complementary scanning paths, all writing to the same findings store:

| Scanner | How it works | Speed | Best for |
|---------|-------------|-------|----------|
| Code scan | Intra-method string rules (9 CWE: SQL/command injection, XXE, weak crypto, hardcoded secrets, path traversal, unsafe deserialization/random, sensitive logging) | Fast | Quick sweeps, has false positives |
| Taint scan | Interprocedural taint tracking (HTTP entry → sink, source-level heuristic) | Slow | Multi-hop taint chains |
| Precise taint scan | WALA IFDS bytecode-level field-sensitive (`repograph-taint-engine`, separate process) | Slow | Highest precision; needs compiled artifacts + a JDK with jmods |
| Dependency scan | SBOM × offline CVE advisory | Fast | Dependency CVEs |

Findings move through the state machine `SUSPECTED → CONFIRMED → FIXED / DISMISSED`; only `CONFIRMED` counts toward the report, with call-chain impact from graph traversal.

**Precise taint scanning** is off by default: run `./gradlew :repograph-taint-engine:installDist` first, then set a JDK-with-jmods path and the engine lib dir under `repograph.taint.precise` and flip `enabled: true`. The engine runs as a separate subprocess, isolated from the app's JDK 25. REST endpoints are in [User Manual §5](docs/user-manual.md).

---

## Roadmap

The product line converges on an **AI-native SAST triage & remediation agent for enterprise security teams**: not rebuilding a scanner from scratch, but ingesting existing SAST / SCA / CI alerts and turning them into explainable, verifiable, fixable, closed-loop triage reports. Full roadmap in [roadmap-codesec-triage-agent.md](docs/generated/roadmap-codesec-triage-agent.md).

```
Phase 1 (done)         Standalone code-audit platform — build and validate the core analysis capabilities
Phase 2 (in progress)  LLM-agent context provider — expose GraphRAG / Context Pack / vuln management as MCP tools
Phase 3 (planned)      SAST triage agent — ingest external alerts, produce evidence chains, false-positive verdicts, and fix suggestions
```

**Phase 2 done**: `search_graphrag` / `search_keyword` / `build_context_pack` / `triage_finding` MCP tools, triage feedback loop, security and agent-orientation tools, precise taint engine integration.
**Next**: persistent BM25 / FTS, hierarchical summaries, citation validation, cross-sub-project call resolution, Go language support.

**Phase 3** spans P0–P4: alert explainer → false-positive triage → PR/CI integration → fix loop → enterprise. Local PRD and task list in `.scratch/codesec-triage-agent/`.

---

## Known Limitations

- Without a full classpath, call resolution can fail when external dependency sources are missing
- Lombok / annotation-processor generated code is unreliable; reflection and dynamic proxy calls cannot be statically traced
- C preprocessor macro expansion, conditional compilation, and function pointer calls are not precisely resolved
- Precise taint scanning requires compiled targets (classes/jars) and a JDK that ships jmods (JDK 17/21 work; JDK 25 does not)

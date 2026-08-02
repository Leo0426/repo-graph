# Contributing to RepoGraph

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| JDK | **25+** | Required for stable FFM API. [Temurin 25](https://adoptium.net/) recommended |
| Docker | latest | For Qdrant and Neo4j in integration tests |
| Ollama | latest | For embedding in integration tests. Pull `manutic/nomic-embed-code` |

## Build from Source

```bash
# Full build, skip tests
./gradlew build -x test

# Build specific module
./gradlew :repograph-app:bootJar -x test
./gradlew :repograph-mcp:bootJar -x test
```

## Running Tests

**Unit tests** — no external services required (Neo4j uses embedded harness):

```bash
./gradlew test --tests "!*IT"
```

**Integration tests** — require Qdrant, Neo4j, and Ollama:

```bash
docker compose up -d
./gradlew test
```

**Retrieval benchmark** — requires a live index:

```bash
# Index repograph-app itself first, then run:
./gradlew :repograph-app:test --tests "*.benchmark.*"
```

Benchmark metrics: Hit@1/3/5/10, MRR@10, HitScore. Tests fail if Hit@10 drops below thresholds (65% semantic, 75% code similarity).

## Project Structure

```
repograph-app/src/main/java/com/repograph/
  core/         Domain model + interfaces (CodeUnit, VectorStore, GraphQueryService)
  parser/       Language parsers
    java/         JavaParser AST
    treesitter/   Tree-sitter FFM (C, Python)
    heuristic/    Fallback state-machine parser
  graph/        Neo4j facade (call chains, impact, type hierarchy)
  vector/       Qdrant gRPC store + Ollama embedding service
  flow/         CFG / PDG / taint analysis (Java)
  framework/    Spring / JAX-RS annotation detection
  vuln/         Vulnerability scanning and advisory store
  app/          Index pipeline + Spring Boot entry point
  api/          Spring MVC REST controllers
```

## Adding a Parser

1. Implement `com.repograph.core.parser.CodeParser`
2. Register in `com.repograph.parser.ParserDispatcher`
3. Add the new language extension to `SourceFileScanner.EXTENSION_TO_LANGUAGE`
4. Write tests under `src/test/java/com/repograph/parser/`

## Code Style

- Follow standard Java conventions (Google Java Style is a good reference)
- No Lombok; explicit constructors and accessors
- New public APIs need a brief Javadoc comment explaining the contract, not the implementation

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Ensure `./gradlew test --tests "!*IT"` passes
3. Keep commits focused — one logical change per commit
4. Open a PR with a clear description of what changes and why

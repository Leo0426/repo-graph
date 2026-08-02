#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${CYAN}[repograph]${NC} $*"; }
ok()    { echo -e "${GREEN}[repograph]${NC} $*"; }
warn()  { echo -e "${YELLOW}[repograph]${NC} $*"; }

# ── Checks ──────────────────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  echo "Error: docker is not installed. See https://docs.docker.com/get-docker/"
  exit 1
fi

if ! command -v java &>/dev/null; then
  echo "Error: java is not installed. JDK 25+ required. See https://adoptium.net/"
  exit 1
fi

# ── Infrastructure ───────────────────────────────────────────────────────────

info "Starting Qdrant and Neo4j..."
docker compose up -d

info "Waiting for Qdrant to be ready..."
until docker compose exec -T qdrant curl -sf http://localhost:6333/readyz &>/dev/null; do
  sleep 2
done
ok "Qdrant is ready."

info "Waiting for Neo4j to be ready..."
until docker compose exec -T neo4j wget -qO- http://localhost:7474 &>/dev/null; do
  sleep 2
done
ok "Neo4j is ready."

# ── Build ────────────────────────────────────────────────────────────────────

info "Building repograph-app (this may take a minute)..."
./gradlew :repograph-app:bootJar -x test -q
ok "Build complete."

JAR=$(ls repograph-app/build/libs/repograph-app-*.jar | grep -v plain | head -1)

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
ok "RepoGraph is ready. Next steps:"
echo ""
echo "  1. Make sure Ollama is running and the model is pulled:"
echo "       ollama pull manutic/nomic-embed-code"
echo ""
echo "  2. Start the server:"
echo "       java --enable-native-access=ALL-UNNAMED \\"
echo "         -jar $JAR"
echo ""
echo "  3. Index your project (in another terminal):"
echo '       curl -X POST \'
echo "         'http://localhost:8080/api/v1/index/project?projectRoot=/path/to/your/project'"
echo ""
echo "  4. Open the web console: http://localhost:8080"
echo ""

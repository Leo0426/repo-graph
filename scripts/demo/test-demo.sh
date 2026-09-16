#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_SCRIPT="$SCRIPT_DIR/repograph-demo.sh"
DATA_DIR="$SCRIPT_DIR/data"
FIXTURE_DIR="$SCRIPT_DIR/showcase-project"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[[ -x "$DEMO_SCRIPT" ]] || fail "repograph-demo.sh must exist and be executable"
bash -n "$DEMO_SCRIPT" || fail "repograph-demo.sh must pass bash syntax validation"

for json_file in "$DATA_DIR/semgrep.json" "$DATA_DIR/findings.sarif.json"; do
    [[ -f "$json_file" ]] || fail "missing test data: $json_file"
    jq empty "$json_file" || fail "invalid JSON: $json_file"
done

for fixture in \
    pom.xml \
    README.md \
    src/main/java/com/acme/showcase/api/OrderController.java \
    src/main/java/com/acme/showcase/api/RefundController.java \
    src/main/java/com/acme/showcase/service/OrderService.java \
    src/main/java/com/acme/showcase/gateway/UnsafeGateway.java \
    src/main/java/com/acme/showcase/security/SecurityShowcase.java; do
    [[ -f "$FIXTURE_DIR/$fixture" ]] || fail "missing showcase fixture: $fixture"
done

for endpoint in \
    /api/v1/health \
    /api/v1/projects \
    /api/v1/search/semantic \
    /api/v1/search/code \
    /api/v1/search/keyword \
    /api/v1/search/graphrag \
    /api/v1/context/pack \
    /api/v1/graph/callers \
    /api/v1/flow/analyze \
    /api/v1/metrics/report \
    /api/v1/sbom/ \
    /api/v1/vulns/scan/code \
    /api/v1/triage/report \
    /api/v1/review-queue/snapshots \
    /api/v1/agent-runs/sast-triage \
    /api/v1/architecture/reviews \
    /api/v1/rules \
    /api/v1/assets/import \
    /api/v1/scanners/capabilities; do
    rg -Fq "$endpoint" "$DEMO_SCRIPT" || fail "demo does not cover endpoint: $endpoint"
done

for signal in \
    executeQuery ProcessBuilder readObject '"MD5"' password Path.of \
    DocumentBuilderFactory 'new Random()' 'log.info'; do
    rg -Fq "$signal" "$FIXTURE_DIR/src/main/java" \
        || fail "showcase data does not include scanner signal: $signal"
done

"$SCRIPT_DIR/test-ui-showcase.sh"

printf 'PASS: demo script and showcase data contract are complete\n'

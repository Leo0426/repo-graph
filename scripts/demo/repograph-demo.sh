#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BASE_URL="${REPOGRAPH_BASE_URL:-http://localhost:8080}"
PROJECT_ROOT="$REPO_ROOT"
OUTPUT_DIR=""
WRITE_MODE=true
IMPORT_ASSET=true
RUN_EXTERNAL_SCAN=true
CLEANUP_ASSET=false
REQUEST_TIMEOUT=300
ASSET_WAIT_SECONDS="${REPOGRAPH_ASSET_WAIT_SECONDS:-300}"

usage() {
    cat <<'USAGE'
Usage: scripts/demo/repograph-demo.sh [options]

Options:
  --base-url URL       RepoGraph address (default: http://localhost:8080)
  --project-root PATH  Already indexed project (default: repository root)
  --output-dir PATH    Result directory outside the indexed root
  --read-only          Skip scans and persistent workflow demonstrations
  --no-asset           Skip archive import/profile/authorization demonstrations
  --no-external-scan   Do not run Semgrep even when it is installed
  --cleanup-asset      Delete the imported showcase asset at the end
  --timeout SECONDS    Per-request timeout (default: 300)
  --asset-wait SECONDS Maximum async asset indexing wait (default: 300)
  -h, --help           Show this help

The default run is a full demonstration. It writes vulnerability scans, triage
feedback, review records, rule audit records, Agent runs, and one imported asset
to RepoGraph's runtime database. Source files are never modified.
USAGE
}

while (($# > 0)); do
    case "$1" in
        --base-url)
            BASE_URL="${2:?missing value for --base-url}"
            shift 2
            ;;
        --project-root)
            PROJECT_ROOT="${2:?missing value for --project-root}"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="${2:?missing value for --output-dir}"
            shift 2
            ;;
        --read-only)
            WRITE_MODE=false
            shift
            ;;
        --no-asset)
            IMPORT_ASSET=false
            shift
            ;;
        --no-external-scan)
            RUN_EXTERNAL_SCAN=false
            shift
            ;;
        --cleanup-asset)
            CLEANUP_ASSET=true
            shift
            ;;
        --timeout)
            REQUEST_TIMEOUT="${2:?missing value for --timeout}"
            shift 2
            ;;
        --asset-wait)
            ASSET_WAIT_SECONDS="${2:?missing value for --asset-wait}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown option: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

for command in curl jq rg tar; do
    command -v "$command" >/dev/null 2>&1 || {
        printf 'Missing required command: %s\n' "$command" >&2
        exit 2
    }
done

[[ -d "$PROJECT_ROOT" ]] || {
    printf 'Project root does not exist: %s\n' "$PROJECT_ROOT" >&2
    exit 2
}
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"
BASE_URL="${BASE_URL%/}"
if [[ -z "$OUTPUT_DIR" ]]; then
    OUTPUT_DIR="$(dirname "$PROJECT_ROOT")/.repograph-demo-results/$(date '+%Y%m%d-%H%M%S')"
fi
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
case "$OUTPUT_DIR/" in
    "$PROJECT_ROOT"/*)
        die_message="Output directory must be outside the indexed project root to avoid file-watcher reindex storms"
        printf '%s: %s\n' "$die_message" "$OUTPUT_DIR" >&2
        exit 2
        ;;
esac

PASS_COUNT=0
SKIP_COUNT=0
ASSET_ID=""

section() {
    printf '\n\033[1;36m== %s ==\033[0m\n' "$1"
}

pass() {
    PASS_COUNT=$((PASS_COUNT + 1))
    printf '\033[32mPASS\033[0m %s\n' "$1"
}

skip() {
    SKIP_COUNT=$((SKIP_COUNT + 1))
    printf '\033[33mSKIP\033[0m %s\n' "$1"
}

die() {
    printf '\033[31mFAIL\033[0m %s\n' "$1" >&2
    exit 1
}

api() {
    local name="$1"
    local method="$2"
    local path="$3"
    shift 3
    local output="$OUTPUT_DIR/$name.json"
    local status
    status="$(curl -sS \
        --connect-timeout 5 \
        --max-time "$REQUEST_TIMEOUT" \
        -o "$output" \
        -w '%{http_code}' \
        -X "$method" \
        "$BASE_URL$path" "$@")" || {
        printf '\nRequest transport failed: %s %s\n' "$method" "$path" >&2
        [[ -s "$output" ]] && sed -n '1,20p' "$output" >&2
        return 1
    }
    if [[ ! "$status" =~ ^2 ]]; then
        printf '\nHTTP %s: %s %s\n' "$status" "$method" "$path" >&2
        sed -n '1,30p' "$output" >&2
        return 1
    fi
    pass "$name"
}

api_optional() {
    local name="$1"
    shift
    if api "$name" "$@"; then
        return 0
    fi
    skip "${name}（当前环境不可用，错误响应已保留）"
    return 1
}

json_summary() {
    local name="$1"
    local filter="$2"
    jq -c "$filter" "$OUTPUT_DIR/$name.json" 2>/dev/null || true
}

poll_agent_run() {
    local run_id="$1"
    local attempt status
    local max_attempts=$((REQUEST_TIMEOUT + 60))
    for attempt in $(seq 1 "$max_attempts"); do
        api "agent-run-$attempt" GET "/api/v1/agent-runs/$run_id" >/dev/null
        status="$(jq -r '.status' "$OUTPUT_DIR/agent-run-$attempt.json")"
        cp "$OUTPUT_DIR/agent-run-$attempt.json" "$OUTPUT_DIR/agent-run-final.json"
        case "$status" in
            WAITING_FOR_REVIEW|COMPLETED|PARTIAL|FAILED|CANCELLED)
                pass "Agent Run 终态：$status"
                return 0
                ;;
        esac
        sleep 1
    done
    die "Agent Run did not reach an observable terminal/review state within ${max_attempts}s"
}

section "0. 前置检查与项目发现"
api health GET /api/v1/health
jq -e '.status == "ok"' "$OUTPUT_DIR/health.json" >/dev/null \
    || die "RepoGraph dependencies are not healthy"
api projects GET /api/v1/projects
PROJECT_ID="$(jq -r --arg root "$PROJECT_ROOT" \
    '.[] | select(.projectRoot == $root) | .projectId' "$OUTPUT_DIR/projects.json" | head -1)"
[[ -n "$PROJECT_ID" ]] || die "Project is not indexed: $PROJECT_ROOT"
api project-stats GET "/api/v1/projects/$PROJECT_ID/stats"
api frameworks GET "/api/v1/frameworks/$PROJECT_ID"
api index-status GET /api/v1/index/project/status \
    -G --data-urlencode "projectRoot=$PROJECT_ROOT"
printf 'projectId=%s, root=%s\n' "$PROJECT_ID" "$PROJECT_ROOT"
json_summary project-stats '{totalUnits, totalEdges, languageDistribution, kindDistribution}'

section "1. 四类检索与 Context Pack"
api search-semantic GET /api/v1/search/semantic -G \
    --data-urlencode 'q=外部静态扫描器如何启动子进程并隔离失败' \
    --data-urlencode 'lang=java' --data-urlencode "projectId=$PROJECT_ID" \
    --data-urlencode 'limit=5' --data-urlencode 'noTest=true'
api search-code GET /api/v1/search/code -G \
    --data-urlencode 'snippet=new ProcessBuilder(command).start()' \
    --data-urlencode 'lang=java' --data-urlencode "projectId=$PROJECT_ID" \
    --data-urlencode 'limit=5'
api search-keyword GET /api/v1/search/keyword -G \
    --data-urlencode 'q=CliProcessRunner ProcessBuilder CWE-78' \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'limit=5'
api search-graphrag GET /api/v1/search/graphrag -G \
    --data-urlencode 'q=命令执行入口、调用链和安全边界' \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'lang=java' \
    --data-urlencode 'limit=8' --data-urlencode 'depth=2'
api context-pack GET /api/v1/context/pack -G \
    --data-urlencode 'q=分析 CliProcessRunner 的命令注入风险与防护' \
    --data-urlencode 'taskType=security' --data-urlencode 'budgetChars=8000' \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'lang=java'
json_summary search-semantic '{total: length, top: (.[0] | {score, qualifiedName: .unit.qualifiedName, filePath: .unit.filePath})}'
json_summary search-graphrag '{total: length, top: (.[0] | {qualifiedName: .unit.qualifiedName, source, finalScore})}'
json_summary context-pack '{evidence: (.evidence | length), seedCount, keywordSeedCount, usedBudgetChars, omittedReasons}'

section "2. 符号定位、调用图、继承图与图诊断"
api symbols GET /api/v1/graph/symbols -G \
    --data-urlencode 'q=CliProcessRunner' --data-urlencode "projectId=$PROJECT_ID" \
    --data-urlencode 'limit=20'
FLOW_TARGET="$(jq -r '[.[] | select(.qualifiedName | contains("CliProcessRunner#run("))][0].qualifiedName // empty' \
    "$OUTPUT_DIR/symbols.json")"
[[ -n "$FLOW_TARGET" ]] || die "Could not resolve CliProcessRunner#run from graph"
FLOW_TARGET_ENCODED="$(jq -rn --arg value "$FLOW_TARGET" '$value | @uri')"
api symbol-detail GET "/api/v1/symbol/$FLOW_TARGET_ENCODED" -G \
    --data-urlencode "projectId=$PROJECT_ID"
api locate GET /api/v1/locate -G \
    --data-urlencode 'file=repograph-app/src/main/java/com/repograph/scanner/CliProcessRunner.java' \
    --data-urlencode 'line=48' --data-urlencode "projectId=$PROJECT_ID"
api graph-callers GET /api/v1/graph/callers -G \
    --data-urlencode "target=$FLOW_TARGET" --data-urlencode 'depth=3' \
    --data-urlencode "projectId=$PROJECT_ID"
api graph-callees GET /api/v1/graph/callees -G \
    --data-urlencode "target=$FLOW_TARGET" --data-urlencode 'depth=3' \
    --data-urlencode "projectId=$PROJECT_ID"
api graph-impact GET /api/v1/graph/impact -G \
    --data-urlencode "target=$FLOW_TARGET" --data-urlencode "projectId=$PROJECT_ID"
api graph-subtypes GET /api/v1/graph/subtypes -G \
    --data-urlencode 'target=com.repograph.core.graph.GraphQueryService' \
    --data-urlencode "projectId=$PROJECT_ID"
api graph-entrypoints GET /api/v1/graph/entrypoints -G \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'lang=java'
api graph-deadcode GET /api/v1/graph/deadcode -G --data-urlencode "projectId=$PROJECT_ID"
api graph-testgaps GET /api/v1/graph/testgaps -G --data-urlencode "projectId=$PROJECT_ID"
api graph-export-dot GET /api/v1/export/graph -G \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'format=dot'
mv "$OUTPUT_DIR/graph-export-dot.json" "$OUTPUT_DIR/dependencies.dot"
api graph-export-mermaid GET /api/v1/export/graph -G \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'format=mermaid'
mv "$OUTPUT_DIR/graph-export-mermaid.json" "$OUTPUT_DIR/dependencies.mmd"
printf 'flowTarget=%s, callers=%s, callees=%s, impact=%s\n' \
    "$FLOW_TARGET" \
    "$(jq length "$OUTPUT_DIR/graph-callers.json")" \
    "$(jq length "$OUTPUT_DIR/graph-callees.json")" \
    "$(jq length "$OUTPUT_DIR/graph-impact.json")"

section "3. CFG / PDG / 数据流与污点追踪"
api flow-analyze GET /api/v1/flow/analyze -G \
    --data-urlencode "target=$FLOW_TARGET" --data-urlencode "projectId=$PROJECT_ID"
api flow-taint GET /api/v1/flow/taint -G \
    --data-urlencode "source=$FLOW_TARGET" --data-urlencode 'paramIndex=0' \
    --data-urlencode 'maxDepth=6' --data-urlencode "projectId=$PROJECT_ID"
json_summary flow-analyze '{target, precise, cfgNodes: (.controlFlowGraph.nodes | length), cfgEdges: (.controlFlowGraph.edges | length), summary}'
json_summary flow-taint '{source: .sourceMethod, methodsAnalyzed, paths: (.paths | length), truncated}'

section "4. 质量指标、健康报告、SBOM 与架构评审"
api metrics-complexity GET /api/v1/metrics/complexity -G \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'limit=10'
api metrics-coupling GET /api/v1/metrics/coupling -G \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'sort=fanout' --data-urlencode 'limit=10'
api metrics-cycles GET /api/v1/metrics/cycles -G --data-urlencode "projectId=$PROJECT_ID"
api metrics-hotspots GET /api/v1/metrics/hotspots -G \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'limit=10'
api metrics-report GET /api/v1/metrics/report -G --data-urlencode "projectId=$PROJECT_ID"
api sbom GET "/api/v1/sbom/$PROJECT_ID" -G \
    --data-urlencode "projectRoot=$PROJECT_ROOT" --data-urlencode 'format=cyclonedx'
api llm-settings GET /api/v1/agent-settings/llm
if ! api_optional architecture-review POST /api/v1/architecture/reviews -G \
    --data-urlencode "projectId=$PROJECT_ID"; then
    true
fi
json_summary metrics-report '{healthScore, totalUnits, packageCycles, highComplexityMethods, testGapCount}'
json_summary sbom '{bomFormat, specVersion, components: (.components | length)}'

section "5. 内置漏洞扫描、状态机、报告与变体"
if [[ "$WRITE_MODE" == true ]]; then
    api vuln-scan-code POST /api/v1/vulns/scan/code -G --data-urlencode "projectId=$PROJECT_ID"
    api vuln-scan-taint POST /api/v1/vulns/scan/taint -G --data-urlencode "projectId=$PROJECT_ID"
    api vuln-scan-deps POST /api/v1/vulns/scan/deps -G \
        --data-urlencode "projectId=$PROJECT_ID" --data-urlencode "projectRoot=$PROJECT_ROOT"
else
    skip "内置漏洞扫描（read-only）"
fi
api vuln-list GET /api/v1/vulns -G --data-urlencode "projectId=$PROJECT_ID"
VULN_ID="$(jq -r '.[0].id // empty' "$OUTPUT_DIR/vuln-list.json")"
if [[ -n "$VULN_ID" ]]; then
    if [[ "$WRITE_MODE" == true ]]; then
        api vuln-confirm PUT "/api/v1/vulns/$VULN_ID/status" -G --data-urlencode 'status=CONFIRMED'
    fi
    api vuln-impact GET "/api/v1/vulns/$VULN_ID/impact"
    api vuln-taint-evidence GET "/api/v1/vulns/$VULN_ID/taint-evidence"
else
    skip "漏洞状态/影响面/证据（项目暂无发现）"
fi
api vuln-report GET "/api/v1/vulns/report/$PROJECT_ID"
api vuln-variants GET /api/v1/triage/variants -G \
    --data-urlencode "projectId=$PROJECT_ID" --data-urlencode 'limit=100'
json_summary vuln-list '{total: length, byRule: (group_by(.ruleId) | map({ruleId: .[0].ruleId, count: length}))}'

section "6. 外部 SAST 研判、反馈、抑制、审核队列与 Agent"
api triage-report POST \
    "/api/v1/triage/report?format=semgrep&projectId=$PROJECT_ID&codeVersion=demo-code-v1&ruleVersion=demo-rule-v1&maxFindings=10" \
    -H 'Content-Type: application/json' \
    --data-binary "@$SCRIPT_DIR/data/semgrep.json"
api triage-sarif POST "/api/v1/triage/report?format=sarif&projectId=$PROJECT_ID&maxFindings=10" \
    -H 'Content-Type: application/json' \
    --data-binary "@$SCRIPT_DIR/data/findings.sarif.json"
FINGERPRINT="$(jq -r '.[0].fingerprint // empty' "$OUTPUT_DIR/triage-report.json")"
[[ -n "$FINGERPRINT" ]] || die "Triage response did not contain a fingerprint"
jq '.[0].report' "$OUTPUT_DIR/triage-report.json" > "$OUTPUT_DIR/triage-report-body.json"
api llm-advisory POST /api/v1/triage/advisory -H 'Content-Type: application/json' \
    --data-binary "@$OUTPUT_DIR/triage-report-body.json"

if [[ "$WRITE_MODE" == true ]]; then
    jq -n --arg fingerprint "$FINGERPRINT" --arg projectId "$PROJECT_ID" '{
        fingerprint: $fingerprint,
        projectId: $projectId,
        status: "NEEDS_REVIEW",
        reviewer: "demo-operator",
        reason: "演示版本一致性反馈闭环",
        codeVersion: "demo-code-v1",
        ruleVersion: "demo-rule-v1"
    }' > "$OUTPUT_DIR/feedback-request.json"
    api triage-feedback POST /api/v1/triage/feedback -H 'Content-Type: application/json' \
        --data-binary "@$OUTPUT_DIR/feedback-request.json"
    api triage-feedback-list GET /api/v1/triage/feedback -G --data-urlencode "projectId=$PROJECT_ID"

    jq -n --arg projectId "$PROJECT_ID" '{
        projectId: $projectId,
        ruleId: "demo.nonexistent.rule",
        scope: "FILE_GLOB",
        scopeValue: "**/generated/**",
        reason: "演示可审计的 scoped suppression",
        createdBy: "demo-operator",
        expiresAt: "2099-12-31T23:59:59Z"
    }' > "$OUTPUT_DIR/suppression-request.json"
    api suppression-create POST /api/v1/triage/suppressions -H 'Content-Type: application/json' \
        --data-binary "@$OUTPUT_DIR/suppression-request.json"
    SUPPRESSION_ID="$(jq -r '.id' "$OUTPUT_DIR/suppression-create.json")"
    api suppression-list GET /api/v1/triage/suppressions -G --data-urlencode "projectId=$PROJECT_ID"
    api suppression-audit-created GET "/api/v1/triage/suppressions/$SUPPRESSION_ID/audit"
    api suppression-revoke POST "/api/v1/triage/suppressions/$SUPPRESSION_ID/revoke" \
        -H 'Content-Type: application/json' \
        --data '{"actor":"demo-operator","reason":"演示撤销与审计"}'
    api suppression-audit-final GET "/api/v1/triage/suppressions/$SUPPRESSION_ID/audit"

    api review-snapshot POST \
        "/api/v1/review-queue/snapshots?format=semgrep&projectId=$PROJECT_ID&codeVersion=demo-code-v1&ruleVersion=demo-rule-v1" \
        -H 'Content-Type: application/json' --data-binary "@$SCRIPT_DIR/data/semgrep.json"
    SNAPSHOT_ID="$(jq -r '.snapshotId' "$OUTPUT_DIR/review-snapshot.json")"
    REVIEW_ENTRY_ID="$(jq -r '.entries[0].id' "$OUTPUT_DIR/review-snapshot.json")"
    api review-list GET /api/v1/review-queue -G --data-urlencode "projectId=$PROJECT_ID"
    api review-claim POST "/api/v1/review-queue/$REVIEW_ENTRY_ID/claim" \
        -H 'Content-Type: application/json' --data '{"actor":"demo-reviewer"}'
    api review-confirm POST "/api/v1/review-queue/$REVIEW_ENTRY_ID/confirm" \
        -H 'Content-Type: application/json' \
        --data '{"actor":"demo-reviewer","reason":"证据链完整，演示确认"}'
    api review-audit GET "/api/v1/review-queue/$REVIEW_ENTRY_ID/audit"
    api review-export GET "/api/v1/review-queue/snapshots/$SNAPSHOT_ID/export" -G \
        --data-urlencode 'format=markdown'
    mv "$OUTPUT_DIR/review-export.json" "$OUTPUT_DIR/review-report.md"

    api agent-start POST \
        "/api/v1/agent-runs/sast-triage?projectId=$PROJECT_ID&format=semgrep&codeVersion=demo-code-v1&ruleVersion=demo-rule-v1" \
        -H 'Content-Type: application/json' --data-binary "@$SCRIPT_DIR/data/semgrep.json"
    AGENT_RUN_ID="$(jq -r '.id' "$OUTPUT_DIR/agent-start.json")"
    poll_agent_run "$AGENT_RUN_ID"
    api agent-list GET /api/v1/agent-runs -G --data-urlencode "projectId=$PROJECT_ID"
else
    skip "反馈、抑制、审核队列和 Agent Run（read-only）"
fi
json_summary triage-report '.[0] | {fingerprint, verdict: .report.verdict, confidence: .report.confidence, citations: (.report.pack.evidence | length)}'

section "7. 检测规则候选、评审、发布与审计"
if [[ "$WRITE_MODE" == true ]]; then
    RULE_ID="DEMO_COMMAND_INJECTION_$(date '+%s')"
    jq -n --arg ruleId "$RULE_ID" '{
        ruleId: $ruleId,
        source: "DEMO",
        languages: ["java"],
        frameworks: ["spring"],
        cwe: "CWE-78",
        severity: "HIGH",
        title: "演示 Runtime.exec 检测规则",
        matcherKind: "SUBSTRING",
        pattern: "Runtime.getRuntime().exec(",
        positiveSamples: ["Runtime.getRuntime().exec(command);"],
        negativeSamples: ["new ProcessBuilder(command).start();"],
        changeNotes: "初始演示版本",
        actor: "demo-rule-author",
        reason: "演示规则生命周期"
    }' > "$OUTPUT_DIR/rule-create-request.json"
    api rule-create POST /api/v1/rules -H 'Content-Type: application/json' \
        --data-binary "@$OUTPUT_DIR/rule-create-request.json"
    RULE_VERSION="$(jq -r '.version' "$OUTPUT_DIR/rule-create.json")"
    api rule-review POST "/api/v1/rules/$RULE_ID/versions/$RULE_VERSION/review" \
        -H 'Content-Type: application/json' \
        --data '{"actor":"demo-rule-reviewer","reason":"回归样本已核验"}'
    api rule-publish POST "/api/v1/rules/$RULE_ID/versions/$RULE_VERSION/publish" \
        -H 'Content-Type: application/json' \
        --data '{"actor":"demo-rule-reviewer","reason":"发布演示规则"}'
    api rule-active GET "/api/v1/rules/$RULE_ID/active"
    api rule-audit GET "/api/v1/rules/$RULE_ID/audit"
else
    api rules-list GET /api/v1/rules
fi

section "8. 归档资产、画像、鉴权证据与外部扫描器"
api scanner-capabilities GET /api/v1/scanners/capabilities
if [[ "$IMPORT_ASSET" == true && "$WRITE_MODE" == true ]]; then
    TEMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TEMP_DIR"' EXIT
    ARCHIVE="$TEMP_DIR/repograph-showcase.tar.gz"
    tar -czf "$ARCHIVE" -C "$SCRIPT_DIR/showcase-project" README.md pom.xml src
    api asset-import POST /api/v1/assets/import -F "file=@$ARCHIVE;type=application/gzip"
    ASSET_ID="$(jq -r '.assetId' "$OUTPUT_DIR/asset-import.json")"
    ASSET_STATUS="INDEXING"
    for attempt in $(seq 1 "$ASSET_WAIT_SECONDS"); do
        api "asset-status-$attempt" GET "/api/v1/assets/$ASSET_ID" >/dev/null
        ASSET_STATUS="$(jq -r '.status' "$OUTPUT_DIR/asset-status-$attempt.json")"
        cp "$OUTPUT_DIR/asset-status-$attempt.json" "$OUTPUT_DIR/asset-status-final.json"
        [[ "$ASSET_STATUS" != "INDEXING" ]] && break
        sleep 1
    done
    if [[ "$ASSET_STATUS" != "READY" ]]; then
        skip "资产后续能力（${ASSET_WAIT_SECONDS}s 内未就绪，last=$ASSET_STATUS；可用 --asset-wait 延长）"
    else
        pass "资产索引完成：$ASSET_ID"
        ASSET_PROJECT_ID="$(jq -r '.projectId' "$OUTPUT_DIR/asset-status-final.json")"
        api asset-profile GET "/api/v1/assets/$ASSET_ID/profile"
        api authorization-evidence GET "/api/v1/assets/$ASSET_ID/authorization-evidence" -G \
            --data-urlencode 'depth=6'
        api asset-sbom GET "/api/v1/sbom/$ASSET_PROJECT_ID" -G \
            --data-urlencode "projectRoot=$(jq -r '.projectRoot' "$OUTPUT_DIR/asset-status-final.json")"
        api asset-vuln-code POST /api/v1/vulns/scan/code -G \
            --data-urlencode "projectId=$ASSET_PROJECT_ID"
        api asset-vuln-taint POST /api/v1/vulns/scan/taint -G \
            --data-urlencode "projectId=$ASSET_PROJECT_ID"
        api asset-vuln-deps POST /api/v1/vulns/scan/deps -G \
            --data-urlencode "projectId=$ASSET_PROJECT_ID" \
            --data-urlencode "projectRoot=$(jq -r '.projectRoot' "$OUTPUT_DIR/asset-status-final.json")"
        api asset-vulns GET /api/v1/vulns -G --data-urlencode "projectId=$ASSET_PROJECT_ID"

        SEMGREP_AVAILABLE="$(jq -r '[.[] | select(.capability.scanner == "SEMGREP" and .available == true)] | length' \
            "$OUTPUT_DIR/scanner-capabilities.json")"
        if [[ "$RUN_EXTERNAL_SCAN" == true && "$SEMGREP_AVAILABLE" -gt 0 ]]; then
            api external-scan-start POST "/api/v1/assets/$ASSET_ID/scan-tasks" \
                -H 'Content-Type: application/json' --data '{"scanners":["SEMGREP"],"timeoutSeconds":120}'
            SCAN_TASK_ID="$(jq -r '.taskId' "$OUTPUT_DIR/external-scan-start.json")"
            SCAN_STATUS="QUEUED"
            for attempt in $(seq 1 150); do
                api "external-scan-status-$attempt" GET "/api/v1/scan-tasks/$SCAN_TASK_ID" >/dev/null
                SCAN_STATUS="$(jq -r '.status' "$OUTPUT_DIR/external-scan-status-$attempt.json")"
                cp "$OUTPUT_DIR/external-scan-status-$attempt.json" "$OUTPUT_DIR/external-scan-final.json"
                case "$SCAN_STATUS" in
                    SUCCEEDED|PARTIAL|FAILED|CANCELLED) break ;;
                esac
                sleep 1
            done
            api external-scan-findings GET "/api/v1/scan-tasks/$SCAN_TASK_ID/findings" -G \
                --data-urlencode 'page=0' --data-urlencode 'size=50'
            api asset-scan-history GET "/api/v1/assets/$ASSET_ID/scans"
            api asset-external-findings GET "/api/v1/assets/$ASSET_ID/external-findings"
            pass "Semgrep 异步任务终态：$SCAN_STATUS"
        else
            skip "Semgrep 执行（命令不可用或已通过参数关闭）"
        fi

        if [[ "$CLEANUP_ASSET" == true ]]; then
            api asset-delete DELETE "/api/v1/assets/$ASSET_ID"
            ASSET_ID=""
        fi
    fi
else
    skip "资产导入与画像（read-only 或 --no-asset）"
fi

section "演示完成"
jq -n \
    --arg baseUrl "$BASE_URL" \
    --arg projectId "$PROJECT_ID" \
    --arg projectRoot "$PROJECT_ROOT" \
    --arg assetId "$ASSET_ID" \
    --arg outputDir "$OUTPUT_DIR" \
    --argjson passCount "$PASS_COUNT" \
    --argjson skipCount "$SKIP_COUNT" \
    '{baseUrl: $baseUrl, projectId: $projectId, projectRoot: $projectRoot,
      assetId: $assetId, passCount: $passCount, skipCount: $skipCount,
      outputDir: $outputDir}' | tee "$OUTPUT_DIR/summary.json"
printf '\nWeb 控制台：%s/\n结果目录：%s\n' "$BASE_URL" "$OUTPUT_DIR"

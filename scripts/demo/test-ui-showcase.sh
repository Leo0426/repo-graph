#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHOWCASE_DIR="$SCRIPT_DIR/showcase-project"
UI_GUIDE="$SCRIPT_DIR/UI_DEMO.md"
SECURITY_STORY="$SHOWCASE_DIR/docs/architecture/security-story.md"
INCIDENT_RUNBOOK="$SHOWCASE_DIR/docs/runbooks/payment-incident.md"

fail() {
    echo "[FAIL] $*" >&2
    exit 1
}

assert_file() {
    [[ -f "$1" ]] || fail "缺少文件：$1"
}

assert_contains() {
    local file="$1"
    local text="$2"
    rg -Fq "$text" "$file" || fail "文件 $file 缺少内容：$text"
}

assert_file "$SECURITY_STORY"
assert_file "$INCIDENT_RUNBOOK"
assert_file "$UI_GUIDE"

for query in \
    "支付订单检索为什么存在 SQL 注入风险" \
    "参数化查询如何阻断 SQL 注入" \
    "未经授权的退款接口如何访问数据库" \
    "供应链中的 Log4Shell 风险" \
    "从 HTTP 入口追踪用户输入到危险 Sink"; do
    assert_contains "$UI_GUIDE" "$query"
done

for symbol in \
    "com.acme.showcase.api.OrderController#search(String)" \
    "com.acme.showcase.gateway.UnsafeGateway#findByCustomer(String)" \
    "com.acme.showcase.api.RefundController#refundWithoutAuthorization(String)" \
    "com.acme.showcase.format.ReportFormatter"; do
    assert_contains "$UI_GUIDE" "$symbol"
done

assert_contains "$SECURITY_STORY" "OrderController#search(String)"
assert_contains "$SECURITY_STORY" "Statement.executeQuery(String)"
assert_contains "$SECURITY_STORY" "CVE-2021-44228"
assert_contains "$INCIDENT_RUNBOOK" "调用链"
assert_contains "$INCIDENT_RUNBOOK" "影响面"

echo "[PASS] UI showcase data contract"

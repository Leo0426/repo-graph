'use strict';

// Fictional DTO fixtures for isolated visual checks. Never forward an /api/ request.
// Shapes follow ProjectInfo, VulnFinding, CodeUnit, SearchPage, AgentRun/Step/StepResult.
const { createHash } = require('node:crypto');
const sha = value => createHash('sha256').update(value).digest('hex');
const at = '2026-10-04T02:00:00Z';
const projectId = 'd3e000000001';
const projects = [
  { projectId, projectRoot: '/demo/Demo Order Service — 虚构示例', nodeCount: 1248, indexedAt: at },
  { projectId: 'd3e000000002', projectRoot: '/demo/Demo Inventory Service — 虚构示例', nodeCount: 386, indexedAt: at },
];

// Deliberately fictional direct dependencies, for SBOM layout and interaction checks only.
const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
  metadata: { timestamp: at, component: { type: 'application', name: 'Demo Order Service — 虚构示例', version: '1.0-demo' } },
  components: [
    ['demo-web', 'required'], ['demo-data', 'required'], ['demo-json', 'required'],
    ['demo-observability', 'required'], ['demo-cache', 'optional'], ['demo-test-support', 'excluded'],
  ].map(([name, scope]) => ({ type: 'library', group: 'example.demo', name, version: '1.0-demo', scope,
    purl: `pkg:maven/example.demo/${name}@1.0-demo` })),
};

function unit(simpleName, owner, signature, line, rawSource, annotations = []) {
  const qualifiedName = `demo.orders.${owner}#${simpleName}(String)`;
  const filePath = `src/main/java/demo/orders/${owner}.java`;
  return { id: sha(filePath + 'METHOD' + qualifiedName), kind: 'METHOD', language: 'java',
    qualifiedName, simpleName, filePath, startLine: line,
    endLine: line + rawSource.split('\n').length - 1, rawSource, signature, annotations,
    parentQualifiedName: `demo.orders.${owner}`, metadata: { framework: 'spring' } };
}
const units = [
  unit('findOrders', 'OrderController', 'public List<Order> findOrders(String customerId)', 42,
    '// DEMO: fictional source for visual verification only\n@GetMapping("/demo/orders")\npublic List<Order> findOrders(String customerId) {\n    return orderService.findOrders(customerId);\n}', ['@GetMapping("/demo/orders")']),
  unit('findOrders', 'OrderService', 'public List<Order> findOrders(String customerId)', 68,
    '// DEMO: fictional source\npublic List<Order> findOrders(String customerId) {\n    return orderRepository.findByCustomerId(customerId);\n}', ['@Transactional(readOnly = true)']),
  unit('findByCustomerId', 'OrderRepository', 'public List<Order> findByCustomerId(String customerId)', 97,
    '// DEMO: deliberately simplified code used only in a UI fixture\npublic List<Order> findByCustomerId(String customerId) {\n    return jdbc.query("SELECT * FROM demo_orders WHERE customer_id = ?", mapper, customerId);\n}', []),
];
const vulnerabilityData = [
  { id: 'd3e0000000000001', projectId, ruleId: 'SQL_INJECTION_TAINT', cwe: 'CWE-89', severity: 'HIGH',
    status: 'SUSPECTED', unitId: units[0].id, qualifiedName: units[0].qualifiedName,
    filePath: units[0].filePath, startLine: 42, title: '[DEMO] 订单查询存在待核实的输入传播路径',
    detail: '虚构示例：请求参数传入订单查询。需要人工核实实际调用位置及参数绑定；不是对真实项目的漏洞结论。', foundAt: at },
  { id: 'd3e0000000000002', projectId, ruleId: 'PATH_TRAVERSAL', cwe: 'CWE-22', severity: 'MEDIUM',
    status: 'SUSPECTED', unitId: sha('demo-download'), qualifiedName: 'demo.orders.ExportController#download(String)',
    filePath: 'src/main/java/demo/orders/ExportController.java', startLine: 83,
    title: '[DEMO] 导出文件名需要验证目录约束',
    detail: '虚构示例：示范较长的风险描述、中文排版和待确认状态。需要检查规范化路径是否仍位于受控导出目录内。', foundAt: at },
  { id: 'd3e0000000000003', projectId, ruleId: 'INFORMATION_EXPOSURE', cwe: 'CWE-209', severity: 'LOW',
    status: 'CONFIRMED', unitId: sha('demo-error'), qualifiedName: 'demo.orders.GlobalErrorHandler#handle(String)',
    filePath: 'src/main/java/demo/orders/GlobalErrorHandler.java', startLine: 26,
    title: '[DEMO] 错误响应包含内部实现细节',
    detail: '虚构的人工已确认状态，仅用于验证状态层级。正式系统应向用户返回稳定错误码，并将诊断细节写入受控日志。', foundAt: at },
];
const taintEvidence = [
  { sequence: 1, role: 'SOURCE', methodQn: units[0].qualifiedName, fromSlot: 'HTTP_REQUEST', toSlot: 'param:0',
    filePath: units[0].filePath, startLine: 42, endLine: 44,
    sourceExcerpt: '// DEMO: fictional request entry\n@GetMapping("/demo/orders")\npublic List<Order> findOrders(String customerId) {' },
  { sequence: 2, role: 'PROPAGATION', methodQn: units[1].qualifiedName, fromSlot: 'param:0', toSlot: 'argument:0',
    filePath: units[1].filePath, startLine: 68, endLine: 70,
    sourceExcerpt: '// DEMO: fictional service layer\npublic List<Order> findOrders(String customerId) {\n    return orderRepository.findByCustomerId(customerId);' },
  { sequence: 3, role: 'SINK', methodQn: units[2].qualifiedName, fromSlot: 'argument:0', toSlot: 'SQL_PARAMETER',
    filePath: units[2].filePath, startLine: 97, endLine: 99,
    sourceExcerpt: '// DEMO: binding behavior still requires review\nreturn jdbc.query("SELECT * FROM demo_orders WHERE customer_id = ?",\n        mapper, customerId);' },
];
const runId = 'demo-run-20261004-order-review';
function step(sequence, capability, status, summary, evidenceReferences, missingInfo = [], results = []) {
  const seconds = (sequence - 1) * 4;
  return { id: `${runId}:step:${sequence}`, runId, sequence, capability, status, summary,
    evidenceReferences, missingInfo, results, error: '',
    startedAt: `2026-10-04T02:00:${String(seconds).padStart(2, '0')}Z`,
    finishedAt: `2026-10-04T02:00:${String(seconds + 3).padStart(2, '0')}Z` };
}
const runData = {
  id: runId, projectId, playbook: 'SAST_TRIAGE', playbookVersion: '1', status: 'WAITING_FOR_REVIEW',
  inputReference: 'vulnerability:d3e0000000000001', outputReference: 'report-snapshot:demo-order-review-snapshot',
  statusReason: '', createdAt: at, updatedAt: '2026-10-04T02:00:20Z', completedAt: '2026-10-04T02:00:20Z',
  steps: [
    step(1, 'LOAD_VULNERABILITY', 'COMPLETED', '[DEMO] 已读取一条虚构订单服务报警，保持原始待确认状态。',
      ['vulnerability:d3e0000000000001']),
    step(2, 'BUILD_CONTEXT', 'COMPLETED', '[DEMO] 已定位控制器、服务与仓储的三段引用，构建可核查上下文。',
      ['code-unit:' + units[0].id, 'code-unit:' + units[1].id, 'code-unit:' + units[2].id],
      ['DEMO：未包含运行时请求样本；反射调用与依赖实现不在此示例中。']),
    step(3, 'TRIAGE_FINDINGS', 'COMPLETED', '[DEMO] 已保留输入传播证据；参数绑定行为仍交由人工核实。',
      ['finding:demo-order-query'], ['DEMO：需要核实真实调用配置，不能据此示例确认漏洞。'],
      [{ subjectReference: 'DEMO:order-query', baseline: 'NEEDS_REVIEW', recommendation: '—',
        uncertainty: 0.65, advisoryOnly: false }]),
    step(4, 'LLM_ADVISORY', 'SKIPPED', '[DEMO] 模型辅助已关闭，继续使用已有启发式证据；未生成模型结论。',
      [], ['LLM_DISABLED']),
    step(5, 'SUBMIT_REVIEW', 'COMPLETED', '[DEMO] 报告示例已冻结，等待人工审核；没有自动确认漏洞。',
      ['report-snapshot:demo-order-review-snapshot']),
  ],
};
const llmSettings = { enabled: false, provider: 'ollama', baseUrl: 'http://preview.invalid',
  model: 'demo-model-disabled', updatedAt: at };

function healthHtml() {
  const health = [
    { key: 'qdrant', name: 'Qdrant', status: 'ok', card: 'h-ok', dot: 'ok', desc: 'DEMO · 向量检索可用（虚构状态）' },
    { key: 'ollama', name: 'Ollama', status: 'error: demo offline', card: 'h-err', dot: 'error', desc: 'DEMO · 模型服务离线（虚构状态）' },
    { key: 'neo4j', name: 'Neo4j', status: 'unknown', card: 'h-unknown', dot: 'checking', desc: 'DEMO · 等待状态确认（虚构状态）' },
  ];
  return health.map(s => `<div class="health-card ${s.card}" data-service="${s.key}"><div class="health-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg></div><div class="health-info"><div class="health-name">${s.name}</div><div class="health-desc" data-i18n="health.${s.key}.desc">${s.desc}</div></div><div class="health-status">${s.status}</div></div>`).join('')
    + health.map(s => `<div class="badge" id="hb-${s.key}" hx-swap-oob="outerHTML" data-health="${s.dot}" title="DEMO · no service was queried"><div id="hd-${s.key}" class="badge-dot ${s.dot}"></div><span>${s.name}</span><span class="badge-state">${s.status}</span></div>`).join('');
}

module.exports = async function installFixtures(page) {
  const vulnerabilities = structuredClone(vulnerabilityData);
  const run = structuredClone(runData);
  const unhandledRequests = [];
  const requested = [];
  const json = (route, body, status = 200) => route.fulfill({ status,
    contentType: 'application/json; charset=utf-8', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
  const handler = async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const pid = url.searchParams.get('projectId');
    requested.push(`${method} ${path}${url.search}`);
    if (path === '/api/fragments/health') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: healthHtml() });
    if (path === '/api/v1/projects') return json(route, projects);
    if (path.startsWith('/api/v1/sbom/')) return json(route, sbom);
    if (path === '/api/v1/agent-settings/llm') return json(route, llmSettings);
    if (path === '/api/v1/agent-settings/llm/test') return json(route,
      { reachable: false, modelAvailable: false, provider: 'ollama', model: llmSettings.model,
        message: 'DEMO: model connection intentionally disabled', models: [] });
    if (path === '/api/v1/vulns') return json(route, vulnerabilities.filter(v =>
      (!pid || v.projectId === pid)
      && (!url.searchParams.get('status') || v.status === url.searchParams.get('status'))
      && (!url.searchParams.get('severity') || v.severity === url.searchParams.get('severity'))));
    if (/^\/api\/v1\/vulns\/[^/]+\/taint-evidence$/.test(path)) return json(route,
      path.includes(vulnerabilities[0].id) ? taintEvidence : []);
    if (/^\/api\/v1\/vulns\/[^/]+\/status$/.test(path)) {
      const v = vulnerabilities.find(item => path.includes(item.id));
      if (!v) return json(route, {}, 404);
      v.status = url.searchParams.get('status') || v.status;
      return json(route, v);
    }
    if (/^\/api\/v1\/vulns\/scan\//.test(path)) return json(route,
      { scannedUnits: 1248, newFindings: 3, entryPoints: 18, pathsAnalyzed: 32, scannedComponents: 28 });
    if (path === '/api/v1/agent-runs') return json(route, pid === projectId ? [run] : []);
    if (/^\/api\/v1\/agent-runs\/(sast-triage|vulnerability-triage)$/.test(path)) return json(route, run, 202);
    if (path === `/api/v1/agent-runs/${run.id}`) return json(route, run);
    if (/^\/api\/v1\/search\/(semantic|code)$/.test(path)) {
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const limit = Math.max(1, Number(url.searchParams.get('limit')) || 10);
      const filtered = units.filter(u => (!url.searchParams.get('lang') || u.language === url.searchParams.get('lang'))
        && (!url.searchParams.get('kind') || u.kind === url.searchParams.get('kind')));
      const results = filtered.slice(offset, offset + limit).map((unit, i) => ({ unit, score: 0.946 - (offset + i) * 0.075 }));
      return json(route, { results, offset, limit, hasMore: offset + results.length < filtered.length });
    }
    if (/^\/api\/v1\/graph\/(callers|callees|impact|subtypes|symbols|entrypoints|deadcode|testgaps)$/.test(path))
      return json(route, pid && pid !== projectId ? [] : units);
    if (path.startsWith('/api/v1/symbol/')) return json(route,
      units.find(u => u.qualifiedName === decodeURIComponent(path.slice('/api/v1/symbol/'.length))) || units[0]);
    if (path === '/api/v1/locate') return json(route, units[0]);
    if (/^\/api\/v1\/projects\/[^/]+\/stats$/.test(path)) {
      const p = projects.find(p => path.includes(p.projectId)) || projects[0];
      const primary = p.projectId === projectId;
      return json(route, { projectId: p.projectId, projectRoot: p.projectRoot, totalUnits: p.nodeCount,
        totalFiles: primary ? 86 : 31, totalEdges: primary ? 2376 : 624, entryPointCount: primary ? 18 : 8,
        testCount: primary ? 146 : 48, kindDistribution: primary ? { METHOD: 932, CLASS: 120, FIELD: 196 } : { METHOD: 280, CLASS: 40, FIELD: 66 },
        languageDistribution: { java: p.nodeCount }, frameworkDistribution: { spring: primary ? 106 : 28 },
        edgeKindDistribution: primary ? { CALLS: 2200, EXTENDS: 100, IMPLEMENTS: 76 } : { CALLS: 570, EXTENDS: 34, IMPLEMENTS: 20 } });
    }
    if (path === '/api/v1/watch') return json(route, method === 'GET' ? [] : { status: 'watching', projectId: pid });
    if (path.startsWith('/api/v1/watch/')) return json(route, { watching: false, projectId: path.split('/').pop() });
    if (path === '/api/v1/index/project/status') return json(route, { status: 'idle' });
    if (path === '/api/v1/index/project') return json(route, method === 'DELETE'
      ? { status: 'deleted', projectId: pid } : { status: 'running', message: 'DEMO: fixture-only indexing response' }, method === 'POST' ? 202 : 200);
    if (path === '/api/v1/metrics/report') return json(route, { projectId: pid, healthScore: 84, totalProductionMethods: 786,
      testGapCount: 42, highComplexityMethods: 6, packageCycles: 0, vulnCritical: 0, vulnHigh: 1, vulnMedium: 1, vulnLow: 1 });
    if (/^\/api\/v1\/metrics\/(complexity|coupling|cycles|hotspots)$/.test(path)) return json(route, []);
    if (path === '/api/v1/export/graph') return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8',
      body: 'graph TD\n  A[Demo Order Controller] --> B[Demo Order Service]\n  B --> C[Demo Order Repository]' });
    if (path === '/api/v1/benchmark/results') return json(route, { error: 'DEMO: no benchmark has been run' }, 404);
    unhandledRequests.push(`${method} ${path}${url.search}`);
    console.warn(`[repograph-ui-preview] unhandled fixture: ${method} ${path}${url.search}`);
    // Conservative empty responses for routes outside this visual scenario, never real API fallback.
    const isCollection = /\/(findings|runs|entries|items|rules|feedback|snapshots|assets|frameworks|review-queue)$/.test(path);
    return json(route, isCollection ? [] : {});
  };
  await page.route('**/api/**', handler);
  return { projects: structuredClone(projects), vulnerabilities, run, units: structuredClone(units), sbom: structuredClone(sbom),
    requested, unhandledRequests, uninstall: () => page.unroute('**/api/**', handler) };
};

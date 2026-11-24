import type { CodeUnit } from './source.js';
import type { Account } from './identity.js';
import type { CodeMetrics, ComplexityMetric, PackageCycle } from './code-metrics.js';
import type { sourceHotspots } from './metric-output.js';
import type { ChangeSnapshot } from './change-review.js';
import type { AgentRun, AgentStep } from './agent-runs.js';
import type { ArchitectureReview } from './architecture-review.js';
import type { BenchmarkSnapshot, BenchmarkSuite } from './benchmark.js';
import type { DependencyScanResult } from './dependency-advisories.js';
import type { FlowAnalysis } from './flow-analysis.js';
import type { GenerationProtocol, ModelProvider } from './model-providers.js';
import type { SummaryDocument, WikiSummaries } from './wiki.js';
import type { ExternalFindings, findingReport } from './external-findings.js';
import type { ExternalFinding } from './finding-import.js';
import type { ReviewQueue, ReviewQueueEntry, ReviewAction } from './review-queue.js';
import type { ArchivedScannerRun, ArchivedScannerSummary, ArchivedScanTask, ScanFindingsPage, ScanHistoryPage } from './scan-history.js';
import type { TriageAdvisory } from './triage-advisory.js';
import type { VulnerabilityFinding, VulnerabilityInventory, VulnerabilityStatus } from './vulnerability-inventory.js';

type View = 'repositories' | 'overview' | 'search' | 'graph' | 'evidence' | 'wiki' | 'findings' | 'review-queue' | 'vulnerabilities'
    | 'scan-history' | 'triage-agent' | 'change-review' | 'benchmark' | 'admin';
type ScanHistoryView = { projectId: string } & (
    { type: 'index'; tasks: ScanHistoryPage<ArchivedScanTask>; runs: ScanHistoryPage<ArchivedScannerSummary> }
    | { type: 'task'; task: ArchivedScanTask; observations: ScanFindingsPage }
    | { type: 'run'; run: ArchivedScannerRun; page: number }
);
type WikiNode = ReturnType<WikiSummaries['tree']>[number];
type FindingList = ReturnType<ExternalFindings['list']>;
type FindingDetail = ReturnType<typeof findingReport>;
type QueuePage = ReturnType<ReviewQueue['list']>;
type QueueView = ReturnType<ReviewQueue['view']>;
type QueueAudit = ReturnType<ReviewQueue['audit']>;
type AdvisoryPanel = 'finding' | 'queue';
type VulnerabilityDetail = ReturnType<VulnerabilityInventory['detail']>;
type Language = 'en' | 'zh';
type Severity = 'error' | 'warning' | 'success';
interface Project { projectId: string; projectName: string; projectRoot: string; nodeCount: number; indexedAt: string; assetId?: string }
interface Hit { unit: CodeUnit; projectId: string; score?: number; finalScore?: number; relation?: string }
interface Evidence {
    citationId: string; projectId: string; qualifiedName: string; filePath: string; startLine: number;
    endLine: number; kind: string; source: string; relation: string; excerpt: string; truncated: boolean;
    unitId?: string; archiveEntry?: string; bytecode?: boolean;
}
interface Pack { evidence: Evidence[]; usedBudgetChars: number; requestedBudgetChars: number; omittedReasons: string[] }
interface IndexJob {
    status: string; parsedFiles?: number; skippedFiles?: number; degradedFiles?: number; totalUnits?: number; totalEdges?: number; errors?: string[];
    stage?: 'scanning' | 'parsing' | 'embedding' | 'finalizing'; done?: number; total?: number; processedFiles?: number; totalFiles?: number;
}
interface ArchiveAsset {
    assetId: string; projectId: string; status: 'INDEXING' | 'READY' | 'FAILED';
    originalFileName: string; archiveType: string; error: string; indexResult: IndexJob | null;
}
interface ArchiveProfile {
    totalFiles: number; categoryDistribution: Record<string, number>; languageDistribution: Record<string, number>;
    buildSystems: string[]; frameworks: string[]; scannerPlan: { scanner: string; selected: boolean }[];
    riskSignals: { type: string; count: number; evidence: string[] }[];
    omittedReasons: string[]; dependencies: { purl: string }[]; dependencyIssues: string[];
    vulnerabilityCounts: Record<string, number>;
}
interface Sbom {
    specVersion: string;
    metadata: { properties?: { name: string; value: string }[] };
    components: { purl: string; scope: string }[];
}
interface ProjectStats {
    projectRoot: string; totalUnits: number; totalFiles: number; totalEdges: number; testCount: number; entryPointCount: number;
    kindDistribution: Record<string, number>; languageDistribution: Record<string, number>;
    frameworkDistribution: Record<string, number>; edgeKindDistribution: Record<string, number>;
}
interface Organization { id: string; name: string; active: boolean }
interface ManagedProject { project: Project; owner: { ownerType: 'PERSONAL' | 'ORGANIZATION'; ownerId: string } | null }
interface AuditEvent { action: string; actorId: string; reason: string; createdAt: string }
interface Administration { accounts: Account[]; organizations: Organization[]; projects: ManagedProject[]; audit: AuditEvent[] }

const zh: Record<string, string> = {
    connectTitle: '连接到工作台', connectDescription: '使用已批准的账号或本地管理员令牌登录。', token: '访问令牌', connect: '连接',
    navigation: '工作台导航', workspace: '工作台', repositories: '仓库', explore: '代码理解', search: '检索',
    graph: '代码图谱', evidence: '证据包', local: '本地工作台', menu: '菜单', repository: '仓库',
    light: '浅色', dark: '深色', disconnect: '断开连接', refresh: '刷新列表',
    repositoriesAbout: '为本地仓库建立索引，检索代码并追踪关系。', repositoryList: '仓库列表', indexRepository: '索引仓库',
    directory: '仓库目录', directoryHint: '使用配置的工作区根目录下的绝对路径。', rebuild: '重建索引', startIndex: '开始索引',
    includeBytecode: '索引 Java 字节码（.class 和 .jar）', archiveEntry: 'JAR 内条目', openSignature: '查看签名',
    searchAbout: '查找符号、相似代码和相关实现。', query: '查询内容', searchPlaceholder: '函数、代码片段或行为描述',
    mode: '模式', keyword: '关键词', semantic: '语义', similarity: '代码相似', scope: '范围', current: '当前仓库',
    all: '全部授权仓库', find: '检索', next: '加载更多', graphAbout: '追踪调用、类型关系并定位源码。',
    target: '符号名称或 ID', graphPlaceholder: '例如 Service.handle', relation: '关系', callers: '调用方',
    callees: '被调用方', subtypes: '子类型', impact: '变更影响', depth: '深度', trace: '查询关系',
    flowAnalyze: '分析方法流', flowControl: '控制流', flowDependence: '程序依赖', flowStep: '节点', flowFrom: '起点', flowTo: '终点',
    flowParameters: '参数', flowFieldReads: '读取字段', flowFieldWrites: '写入字段', flowReturnSources: '返回值引用',
    flowNoEdges: '当前节点没有关联边。', flowEdgeLimit: '仅显示当前节点的前 100 条关联边。',
    flowConservative: '此结果使用保守的控制流模型。', FLOW_TARGET_UNAVAILABLE: '当前索引没有该符号可分析的源码。',
    AMBIGUOUS_FLOW_TARGET: '目标名称对应多个符号。请使用符号 ID。', FLOW_ANALYSIS_LIMIT: '该方法超过流分析预算。',
    flowNodeENTRY: '入口', flowNodeEXIT: '出口', flowNodeSTATEMENT: '语句', flowNodeCONDITION: '条件',
    flowNodeRETURN: '返回', flowNodeTHROW: '抛出', flowNodeCATCH: '捕获', flowNodeFINALLY: '清理',
    NEXT: '下一步', TRUE_BRANCH: '条件为真', FALSE_BRANCH: '条件为假', LOOP_BACK: '循环回边', CASE_BRANCH: '分支匹配',
    EXCEPTION_BRANCH: '异常分支', DATA_DEPENDENCY: '数据依赖', CONTROL_DEPENDENCY: '控制依赖',
    EXPRESSION_LEVEL_CONTROL_NOT_EXPANDED: '表达式内的分支未展开。', UNRESOLVED_CONTROL_TRANSFER: '有跳转目标无法解析。',
    UNSUPPORTED_CONTROL_SYNTAX: '部分控制语法未展开。', UNSUPPORTED_SWITCH_CASE: '部分 switch 分支未识别。',
    CONTEXT_MANAGER_CLEANUP_NOT_MODELED: '未模拟 with 的退出操作。', RESOURCE_CLEANUP_NOT_MODELED: '未模拟隐式资源关闭。',
    locate: '按文件和行号定位源码', file: '相对路径', line: '行号', openSource: '打开源码',
    evidenceAbout: '收集相关源码片段和可追溯的仓库、文件及行号引用。', evidencePlaceholder: '描述需要的上下文',
    budget: '字符预算', buildPack: '生成证据包', close: '关闭', sourceLink: '源码链接', copy: '复制源码',
    choose: '选择仓库', emptyRepos: '还没有已索引的仓库。', noResults: '未找到匹配结果。', openSearch: '打开检索',
    remove: '移除索引', removeConfirm: '移除这个仓库的索引？磁盘上的源码将保留。', load: '加载中…', units: '个符号',
    indexing: '正在索引…', done: '索引完成', partial: '索引部分完成', indexError: '索引失败', idle: '未发现此索引任务',
    indexScanning: '正在扫描文件', indexParsing: '正在处理文件', indexEmbedding: '正在为当前文件生成向量',
    indexFinalizing: '正在保存索引结果', indexProcessed: '已处理文件',
    statusRetry: '暂时无法读取索引状态，正在重试。', filesParsed: '已解析', filesSkipped: '已跳过', relations: '条关系',
    parseStrategy: '解析策略', parseAuto: '自动', parsePrecise: '精确', parseHeuristic: '启发式', filesDegraded: '已降级',
    pickFirst: '请先选择仓库。', matches: '条结果', copied: '已复制', copyFailed: '无法复制，请选择并手动复制。',
    failed: '请求失败', wrongToken: '访问令牌无效。', expired: '连接已过期，请重新连接。', noNetwork: '无法连接本地服务。',
    excerptBudget: '已用字符', truncated: '已截断', vectorDisabled: '向量检索未启用。', vectorUnavailable: '向量服务暂不可用。',
    noEvidence: '未找到匹配的证据。', candidateLimit: '已达到候选结果上限。', match: '条结果',
    overview: '仓库概览', allFiles: '文件', allUnits: '符号', allRelations: '关系', testUnits: '测试符号',
    entryPoints: '入口点', languageBreakdown: '语言分布', symbolKinds: '符号类型', frameworks: '框架', relationKinds: '关系类型',
    method: '登录方式', account: '账号', username: '用户名', password: '密码', register: '注册账号', displayName: '显示名称',
    email: '邮箱', submitRegistration: '提交审核', pendingApproval: '注册申请已提交，请等待管理员批准。',
    invalidCredentials: '凭据无效或账号尚未获批。', passwordChanged: '密码已更新，请重新登录。',
    oldPassword: '当前密码', newPassword: '新密码', changePassword: '修改密码',
    admin: '管理', adminAbout: '审核账号并管理已索引仓库的访问权限。', accounts: '账号列表',
    decision: '处理方式', reason: '原因', saveReview: '保存审核', organizations: '组织', organization: '组织',
    organizationName: '组织名称', active: '启用', saveOrganization: '保存组织', member: '组织成员',
    saveMembership: '保存成员关系', ownership: '仓库归属', ownerType: '归属类型', personal: '个人', owner: '归属对象',
    assign: '分配仓库', audit: '管理审计', chooseAccount: '选择账号', newOrganization: '新建组织',
    chooseOwner: '选择归属对象', unassigned: '未分配，仅管理员可见', saved: '已保存', noMembers: '暂无成员',
    PENDING: '待审核', ACTIVE: '已启用', REJECTED: '已拒绝', DISABLED: '已停用',
    archiveUpload: '导入源码归档', archiveFile: 'ZIP、TAR.GZ 或 JAR 文件', importArchive: '导入并索引',
    archiveProfile: '归档画像', archiveFiles: '归档文件数', archiveFormat: '原始归档',
    archiveUploading: '正在上传和解压…', archiveReady: '归档已就绪', archiveFailed: '归档索引失败',
    archivePartial: '归档已就绪，索引部分完成', removeArchive: '删除托管归档',
    archiveReindex: '重建归档索引',
    removeArchiveConfirm: '删除此归档的托管源码副本和索引？',
    categories: '文件分类', buildSystems: '构建系统', recommendedScanners: '推荐扫描器',
    assetsArchive: '归档', sensitivePaths: '疑似敏感配置路径',
    sbomTitle: '依赖清单', sbomPreview: '生成 SBOM', sbomDownload: '下载 CycloneDX JSON',
    dependencyScan: '检查 Maven 依赖公告', dependencyMatches: '匹配的公告', dependencyNew: '新增疑似记录',
    dependencyScanned: '已检查组件', dependencyUnverified: '无法核验的组件', dependencyCoordinate: '依赖坐标',
    dependencyAdvisory: '依赖公告', dependencyFixed: '公告修复版本', dependencySource: '公告来源',
    dependencyMore: '其余匹配可在漏洞库存中查看。',
    watchStart: '启动文件监听', watchStop: '停止文件监听', watchActive: '文件变更时自动更新索引', watchIdle: '文件监听已停止',
    qualityTitle: '代码质量', qualityMeasure: '质量指标', qualityReport: '健康报告', qualityComplexity: '圈复杂度',
    qualityCoupling: '耦合度', qualityCycles: '包循环', qualityHotspots: 'Git 变更热点', qualityDead: '疑似未调用',
    qualityGaps: '测试缺口', qualityRead: '运行分析', downloadDot: '下载 DOT', downloadMermaid: '下载 Mermaid',
    qualityScore: '健康分', productionMethods: '生产代码单元', instability: '不稳定度', fanIn: '传入', fanOut: '传出',
    changeCount: '变更次数', hotspotScore: '热点分', qualitySymbol: '符号', heuristics: '基于静态调用图的候选，需结合实际运行路径核实。',
    wiki: '仓库 Wiki', wikiAbout: '浏览已索引的模块、入口及其源码引用。', wikiGenerate: '生成摘要', wikiChoose: 'Wiki 文档',
    wikiRun: '生成步骤', wikiEmpty: '还没有 Wiki 文档。', wikiCitations: '源码引用', wikiGenerated: '已生成 Wiki 摘要。',
    legacyWiki: '从旧版迁移的 Wiki 文档', LEGACY_WIKI_CITATION_UNAVAILABLE: '部分旧引用缺少安全的项目路径或有效行号。',
    wikiPartial: '已生成部分摘要，详见生成步骤。', wikiFailedRun: 'Wiki 生成失败。', wikiPending: '摘要仍在生成，可刷新此页面继续查看。',
    wikiNotes: '缺失信息', wikiCurrentIndex: '引用链接打开当前索引中的源码位置。',
    QUEUED: '排队中', RUNNING: '运行中', SKIPPED: '已跳过',
    WIKI_MODEL_UNAVAILABLE: '生成模型暂不可用。', WIKI_INDEX_RUNNING: '请等待当前索引任务完成。',
    WIKI_ALREADY_RUNNING: '此仓库已有 Wiki 生成任务。', WIKI_QUEUE_FULL: 'Wiki 任务队列已满。',
    WIKI_UNIT_LIMIT: '已达到符号采样上限。', WIKI_MODULE_LIMIT: '已达到模块采样上限。', WIKI_CALL_LIMIT: '已达到调用采样上限。',
    WIKI_INDEX_HAS_PENDING_FILES: '索引内有等待重试的文件。',
    wikiModelSection: '模型摘要', wikiFactCollection: '收集结构事实', wikiModelGeneration: '生成模型章节', wikiPersist: '保存文档', wikiStepFailed: '失败',
    'wikiPhase:overview': '项目概述', 'wikiPhase:modules': '模块划分', 'wikiPhase:entrypoints': '入口与调用链',
    'wikiPhase:build': '构建与运行', 'wikiPhase:security': '安全相关面',
    WIKI_UNKNOWN_CITATIONS: '已省略模型提供的未知引用。', INVALID_WIKI_SECTION: '模型章节格式无效。',
    WIKI_MODEL_DEADLINE: '生成任务已达到时间上限。', WIKI_MODEL_SECTIONS_INCOMPLETE: '部分模型章节暂不可用。',
    generationProviders: '生成模型配置', providerProfile: '配置档案', providerName: '名称', providerProtocol: '协议',
    providerUrl: '服务基地址', providerModel: '模型 ID', providerKey: 'API 密钥', providerTimeout: '超时（毫秒）',
    providerTokens: '输出 token 上限', providerInputPrice: '每百万输入 token 美元价格', providerOutputPrice: '每百万输出 token 美元价格',
    providerClearKey: '清除已保存密钥', providerSave: '保存配置', providerDiscover: '发现模型', providerTest: '测试已保存配置',
    providerSelect: '选用已保存配置', providerDelete: '删除配置', providerNew: '新建配置', providerSelected: '当前使用',
    providerKeySaved: '密钥已保存', providerDeleteConfirm: '删除这个模型配置？', providerModelsFound: '已获取模型列表，可选择或手动填写。',
    PROVIDER_CONNECTED: '连接与模型调用成功。', PROVIDER_CREDENTIAL_CHANGE_REQUIRED: '更改地址或协议时，请更换或清除保存的密钥。',
    PROVIDER_TIMEOUT: '模型请求超时。', PROVIDER_REDIRECT_BLOCKED: '模型端点返回了重定向。',
    architectureReview: '架构评审', architectureReady: '已收集静态证据，正在生成评审。', architectureSuggestions: '模型建议',
    architectureDisabled: '已收集静态事实。生成模型已停用。', architectureFailed: '已收集静态事实。模型评审生成失败。',
    architectureProblem: '问题', architectureSuggestion: '建议', architectureBenefit: '收益', architectureCost: '实施成本', architectureRisk: '风险',
    architectureEvidence: '静态证据', architectureUsage: '模型用量', architecturePriceUnknown: '费用未知',
    evidenceReference: '引用', evidenceSummary: '摘要',
    ARCHITECTURE_UNKNOWN_CITATIONS: '已省略模型提供的未知引用。', ARCHITECTURE_STREAM_FAILED: '架构评审连接已断开。',
    'change-review': '变更评审', changeAbout: '提交 unified diff，冻结当前仓库索引中的评审证据。',
    legacyChangeReview: '从旧版迁移的变更评审快照', legacyChangeFindings: '旧版报警指纹', legacyChangeVulnerabilities: '旧版漏洞记录 ID',
    LEGACY_CHANGE_PATH_UNAVAILABLE: '旧路径无法定位至当前项目。', LEGACY_CHANGE_HUNK_MAPPING_UNAVAILABLE: '旧记录未提供唯一的分组引用。',
    findings: '外部报警', findingsAbout: '导入扫描报告，对照索引查看报警位置。', findingFormat: '报告格式',
    findingVersion: '报告代码版本（可选）', findingFile: '报告文件', findingImport: '导入报告', findingDetails: '报警详情',
    findingRuleVersion: '报告规则版本（可选）', findingFeedback: '人工反馈', findingFeedbackSave: '保存反馈',
    findingFeedbackSaved: '已保存人工反馈。', findingFeedbackVersions: '导入时填写代码和规则版本，可在后续研判中复用反馈。',
    findingDecisionApplied: '已采用', findingDecisionSkipped: '未采用',
    advisoryAction: '请求模型复核', advisoryTitle: '模型建议（供人工参考）', advisoryBaseline: '基础研判',
    advisoryDISABLED: '生成模型已停用。', advisoryTIMED_OUT: '模型复核超时。', advisoryFAILED: '模型复核未完成。',
    advisoryBUDGET_EXCEEDED: '模型复核超出预算。', advisoryWithoutVerdict: '模型未给出有证据支持的结论。',
    ADVISORY_INPUT_TRUNCATED: '部分证据因输入范围或预算被省略。',
    ADVISORY_UNKNOWN_CITATIONS: '已丢弃模型给出的未知引用。',
    ADVISORY_VERDICT_WITHOUT_EVIDENCE: '模型结论缺少已登记的证据。',
    'triage-agent': '研判 Agent', triageAbout: '汇集报警证据并提交人工审核。', triagePrepare: '准备研判',
    triageInput: '输入来源', triageUpload: '扫描报告', triageFinding: '已导入报警', triageVulnerability: '漏洞库存记录',
    triageTarget: '选择记录', triageAdvanced: '版本与证据预算', triageBudget: '证据字符上限', triageStart: '启动研判',
    triageTimeline: '运行时间线', triageHistory: '最近运行', triageEmpty: '此项目还没有研判运行。', triageNoTargets: '当前项目没有可选记录。',
    triageStateUnknown: '暂时无法读取最新状态，已保留上次读取的步骤。', triageStepFailed: '失败',
    triageStepPending: '等待执行', triageLegacyRun: '从旧版迁移的运行',
    triageLegacyOutputUnavailable: '该次运行引用的报告在当前项目中不可用。',
    PROCESS_INTERRUPTED: '原进程已中断。', LEGACY_DETAIL_OMITTED: '已省略旧版错误原文。',
    IMPORT_FINDINGS: '读取扫描报告', LOAD_FINDINGS: '读取报警', LOAD_VULNERABILITY: '读取漏洞库存记录',
    BUILD_CONTEXT: '构建证据包', TRIAGE_FINDINGS: '生成基础研判', LLM_ADVISORY: '模型复核', SUBMIT_REVIEW: '提交人工审核',
    GENERATION_DISABLED: '生成模型已停用。', SAST_TRIAGE_ALREADY_RUNNING: '此项目已有研判运行。',
    SAST_TRIAGE_QUEUE_FULL: '研判队列已满。', NO_REVIEWABLE_FINDINGS: '报告中没有可审核的报警。',
    HISTORICAL_FEEDBACK: '历史人工反馈', RULE_SUPPRESSION: '规则抑制',
    TRUE_POSITIVE: '确认风险', FALSE_POSITIVE: '确认误报', FINDING_FEEDBACK_VERSION_MISMATCH: '复用反馈需要代码和规则版本均匹配。',
    findingPrevious: '上一页', findingNext: '下一页', findingRule: '规则', findingSeverity: '严重度', findingEmpty: '此项目还没有外部报警。',
    findingImported: '已导入', findingDuplicates: '重复条目', findingSkipped: '已跳过', findingTrace: '工具报告的路径',
    NEEDS_REVIEW: '待人工研判', TRUE_RISK: '有证据支持的风险', LIKELY_FALSE_POSITIVE: '可能误报',
    FINDING_REPORT_VERSION_UNVERIFIED: '报告与当前索引的代码版本尚未核验。',
    FINDING_SYMBOL_FALLBACK: '按报告中的符号定位。', FINDING_LOCATION_UNINDEXED: '当前索引未找到该位置。',
    FINDING_SOURCE_SINK_TRACE_UNAVAILABLE: '报告缺少来源到终点的路径。',
    FINDING_SOURCE_SINK_TRACE_INCOMPLETE: '报告的路径缺失、超限或顺序不明。',
    FINDING_PROTECTION_RUNTIME_UNVERIFIED: '候选防护的运行时行为和生效条件待复核。',
    PATH_PROTECTION: '路径防护候选', findingTracePath: '路径编号',
    SOLIDITY_INDEX_UNAVAILABLE: '当前项目没有可用的 Solidity 索引引用。',
    MATCHED_DECLARED_VERSION: '声明版本一致', UNVERIFIED: '版本未核验',
    'review-queue': '审核队列', queueAbout: '查看冻结报警并记录审核决定。', queueFrozen: '冻结报告', queueStatus: '审核状态',
    queueDownloadPdf: '下载 PDF', queueExportFormat: '导出格式', queueBatch: '下载所选快照', queueSelect: '选择快照以导出',
    queueSubmit: '提交人工审核', queueClaim: '认领', queueReturn: '退回队列', queueConfirm: '确认', queueReject: '驳回',
    queueMore: '查看审核', queueEmpty: '没有符合条件的审核条目。', queueAudit: '审核记录',
    legacyReport: '从旧版迁移的冻结报告', legacyScan: '历史扫描', queueReportMatches: '同指纹报告数量',
    'scan-history': '扫描历史', scanHistoryAbout: '查看扫描任务、工具运行记录和报警。',
    scanTasks: '扫描任务', scanRuns: '工具运行', scanTask: '扫描任务', scanRun: '工具运行', scanState: '运行状态',
    startSemgrep: '运行 Semgrep', startCodeQl: '运行 CodeQL', startSlither: '运行 Slither', cancelScan: '取消扫描', retryScan: '重试扫描',
    SCANNER_NOT_CONFIGURED: '服务端尚未配置 Semgrep 规则文件', SCANNER_UNAVAILABLE: '扫描工具不可用',
    CODEQL_NOT_CONFIGURED: '服务端尚未配置 CodeQL', CODEQL_NO_SUPPORTED_SOURCE: '归档没有可分析的源码',
    SLITHER_NOT_CONFIGURED: '服务端尚未配置 Slither 和 Solidity 编译器', SLITHER_NO_SUPPORTED_SOURCE: '归档没有 Solidity 源码',
    SLITHER_SOURCE_INCOMPLETE: '无法读取 Solidity 源码', SLITHER_ANALYSIS_FAILED: 'Slither 编译或分析失败',
    SCANNER_TIMED_OUT: '扫描超时', SCAN_CANCELLED: '扫描已取消', SCANNER_INCOMPLETE_REPORT: '仅保存了可读取的扫描结果',
    scanTime: '记录时间', scanObservations: '留存报警', scanAttempt: '尝试次数', scanBatch: '批次', scanAsset: '归档资产',
    scanMissingAsset: '资产未迁移', scanOriginalState: '中断前状态', scanToolVersion: '工具版本', scanExitCode: '退出码',
    scanMessage: '报警内容', LEGACY_SCAN_ERROR_OMITTED: '旧版错误原文已省略。',
    benchmark: '检索评测', benchmarkAbout: '查看评测使用的语料仓库及其最近一次保存的结果。', benchmarkRefresh: '读取最新结果',
    benchmarkEmpty: '暂无已保存的评测。', benchmarkSemantic: '语义检索', benchmarkCode: '代码相似检索',
    benchmarkPassed: '达到阈值', benchmarkFailed: '未达阈值', benchmarkThreshold: 'Hit@10 阈值', benchmarkQueries: '查询数',
    benchmarkUnavailable: '报告未包含此项。', benchmarkNoQueries: '报告未包含此项的测试查询。', benchmarkOnlyMisses: '只看未命中',
    benchmarkRank: '首个命中排名', benchmarkTopResult: '首条结果', benchmarkTopScore: '首条结果分数', benchmarkHitScore: '命中分数',
    benchmarkMissed: '未命中', benchmarkRetained: '刷新失败，继续显示上次读取的评测。', INVALID_BENCHMARK_RESULTS: '评测报告格式无效。',
    SUCCEEDED: '成功', TIMED_OUT: '超时', UNAVAILABLE: '不可用', scanFailed: '失败', scanQueued: '排队中', scanRunning: '运行中',
    IN_REVIEW: '审核中', CONFIRMED: '已确认', SUBMIT: '提交', CLAIM: '认领', RETURN: '退回', CONFIRM: '确认', REJECT: '驳回',
    REVIEW_STATE_CONFLICT: '条目已更新，请查看最新状态。', REVIEW_REASON_REQUIRED: '请填写审核理由。',
    vulnerabilities: '漏洞库存', vulnAbout: '追踪已登记的记录及其审核历史。', vulnAdd: '登记为疑似', vulnOpen: '查看库存记录',
    vulnEmpty: '没有符合条件的库存记录。', vulnActive: '活动漏洞记录', vulnOptionalReason: '状态变更理由（可选）',
    codeScan: '检查已索引源码', codeScanComplete: '源码检查完成', codeScanChecked: '已检查单元',
    codeScanNew: '新增疑似记录', CODE_SCAN_INDEX_CHANGED: '索引已更新，请重新运行检查。',
    taintScan: '追踪请求参数', taintScanComplete: '参数追踪完成', taintScanPartial: '已保存部分追踪结果', taintScanChecked: '已检查入口',
    SUSPECTED: '疑似', FIXED: '已修复', DISMISSED: '已忽略', vulnConfirm: '确认为漏洞', vulnFix: '标记已修复', vulnDismiss: '忽略记录',
    VULNERABILITY_STATE_CONFLICT: '库存记录已更新，请查看当前状态。', INVALID_VULNERABILITY_TRANSITION: '当前状态不允许此操作。',
    legacyVulnerability: '从旧版库存迁移', legacyVulnerabilityEvidence: '历史证据', taintScanEvidence: '参数流证据',
    legacyEvidenceSOURCE: '来源', legacyEvidencePROPAGATION: '传播', legacyEvidenceSINK: '终点',
    changeBase: '基线版本', changeTarget: '目标版本', changeDiff: 'Unified diff', changeSubmit: '创建快照',
    changeSnapshot: '评审快照', changeLink: '快照链接', downloadJson: '下载 JSON', downloadMarkdown: '下载 Markdown',
    changeLedger: 'Hunk 纳入记录', changePlanned: '已纳入', changeOmitted: '已省略', changeMapping: '索引映射',
    changeReason: '原因', changeExcerpt: '冻结证据', changePreviewLimit: '完整记录请下载快照。',
    changeModelStart: '运行模型评审', changeModelRun: '模型评审', changeModelCancel: '取消任务',
    changeAdvisoryOnly: '供人工参考', CHANGE_REVIEW_MODEL_UNAVAILABLE: '生成模型暂不可用。',
    CHANGE_VERIFICATION_UNAVAILABLE: '隔离验证暂不可用。', CHANGE_REVIEW_INVALID_CITATIONS: '已省略未读取或未知的引用。',
    CANCELLED: '已取消', WAITING_FOR_REVIEW: '等待人工评审', BUILD_CHANGE_REVIEW: '取得冻结快照', REVIEW_UNIT: '评审单元',
    READ_REVIEW_CONTEXT: '读取证据', VERIFY_CHANGE: '请求验证',
    COMPLETED: '已完成', PARTIAL: '部分完成', FAILED: '无法生成评审', MAPPED: '已映射', UNMAPPED: '未完整映射',
    PLANNED: '已纳入', OMITTED: '已省略', INDEX_VERSION_UNVERIFIED: '索引与提交的版本标记尚未核验。',
    EXTERNAL_FINDINGS_UNAVAILABLE: '外部报警清单暂不可用。', INDEX_LINE_CONTENT_DIFFERS: '新增行与当前索引内容不同。',
    sbomComponents: '依赖组件数', sbomPreviewLimit: '预览前 50 个组件，下载查看完整清单。',
    NO_SUPPORTED_MANIFEST: '仓库根目录没有受支持的构建清单。',
    BUSINESS: '业务', TEST: '测试', DOCUMENTATION: '文档', GENERATED: '生成内容', UNKNOWN: '未知',
    DEPENDENCY_INVENTORY_UNAVAILABLE: '依赖清单暂不可用', VULNERABILITY_INVENTORY_UNAVAILABLE: '漏洞清单暂不可用',
    SOURCE_HOTSPOTS_UNAVAILABLE: '源码热点暂不可用'
};

const englishDynamic: Record<string, string> = {
    flowControl: 'Control flow', flowDependence: 'Program dependencies', flowStep: 'Node', flowFrom: 'From', flowTo: 'To',
    flowParameters: 'Parameters', flowFieldReads: 'Fields read', flowFieldWrites: 'Fields written', flowReturnSources: 'Return references',
    flowNoEdges: 'This node has no connected edges.', flowEdgeLimit: 'Showing the first 100 connected edges for this node.',
    flowConservative: 'This result uses a conservative control-flow model.', FLOW_TARGET_UNAVAILABLE: 'This symbol has no analyzable source in the index.',
    AMBIGUOUS_FLOW_TARGET: 'Multiple symbols match. Enter a symbol ID.', FLOW_ANALYSIS_LIMIT: 'This procedure exceeds the flow analysis budget.',
    flowNodeENTRY: 'Entry', flowNodeEXIT: 'Exit', flowNodeSTATEMENT: 'Statement', flowNodeCONDITION: 'Condition',
    flowNodeRETURN: 'Return', flowNodeTHROW: 'Throw', flowNodeCATCH: 'Catch', flowNodeFINALLY: 'Finally',
    NEXT: 'Next', TRUE_BRANCH: 'True branch', FALSE_BRANCH: 'False branch', LOOP_BACK: 'Loop back', CASE_BRANCH: 'Case branch',
    EXCEPTION_BRANCH: 'Exception branch', DATA_DEPENDENCY: 'Data dependency', CONTROL_DEPENDENCY: 'Control dependency',
    EXPRESSION_LEVEL_CONTROL_NOT_EXPANDED: 'Branches inside expressions are collapsed.', UNRESOLVED_CONTROL_TRANSFER: 'A jump target could not be resolved.',
    UNSUPPORTED_CONTROL_SYNTAX: 'Some control statements are collapsed.', UNSUPPORTED_SWITCH_CASE: 'Some switch cases could not be recognized.',
    CONTEXT_MANAGER_CLEANUP_NOT_MODELED: 'Context manager exit actions are not modeled.', RESOURCE_CLEANUP_NOT_MODELED: 'Implicit resource cleanup is not modeled.',
    openSignature: 'View signature',
    choose: 'Choose a repository', emptyRepos: 'No repositories are indexed yet.', noResults: 'No matching results.',
    openSearch: 'Open search', remove: 'Remove index', removeConfirm: 'Remove this repository index? The source files will remain on disk.',
    load: 'Loading…', units: 'symbols', indexing: 'Indexing…', done: 'Index complete', partial: 'Index partially complete',
    indexScanning: 'Scanning files', indexParsing: 'Processing files', indexEmbedding: 'Embedding the current file',
    indexFinalizing: 'Saving index results', indexProcessed: 'Files processed',
    indexError: 'Index failed', idle: 'Index task not found', statusRetry: 'Index status is temporarily unavailable. Retrying…',
    filesParsed: 'Parsed', filesSkipped: 'Skipped', relations: 'relationships', pickFirst: 'Choose a repository first.',
    filesDegraded: 'Recovered',
    matches: 'results', copied: 'Copied', copyFailed: 'Could not copy. Select the source to copy it manually.', dark: 'Dark',
    failed: 'Request failed', wrongToken: 'Invalid access token.', expired: 'The connection expired. Connect again.',
    noNetwork: 'Could not reach the local service.', excerptBudget: 'Characters used', truncated: 'Truncated',
    vectorDisabled: 'Vector search is disabled.', vectorUnavailable: 'The vector service is unavailable.',
    noEvidence: 'No matching evidence.', candidateLimit: 'The candidate limit was reached.', match: 'result',
    allFiles: 'Files', allUnits: 'Symbols', allRelations: 'Relationships', testUnits: 'Test symbols',
    entryPoints: 'Entry points', languageBreakdown: 'Languages', symbolKinds: 'Symbol types', frameworks: 'Frameworks',
    relationKinds: 'Relationship types', pendingApproval: 'Registration submitted. An administrator must approve the account.',
    invalidCredentials: 'Invalid credentials or approval pending.', passwordChanged: 'Password changed. Sign in again.',
    chooseAccount: 'Choose an account', newOrganization: 'New organization', chooseOwner: 'Choose an owner',
    unassigned: 'Unassigned. Visible to administrators.', saved: 'Saved', noMembers: 'No members yet',
    PENDING: 'Pending review', ACTIVE: 'Active', REJECTED: 'Rejected', DISABLED: 'Disabled',
    archiveFiles: 'Files in archive', archiveFormat: 'Original archive',
    archiveUploading: 'Uploading and extracting…', archiveReady: 'Archive ready', archiveFailed: 'Archive indexing failed',
    archivePartial: 'Archive ready with partial indexing', removeArchive: 'Delete managed archive',
    archiveReindex: 'Reindex archive',
    removeArchiveConfirm: 'Delete the managed source copy and its index?',
    categories: 'File categories', buildSystems: 'Build systems', recommendedScanners: 'Suggested scanners',
    assetsArchive: 'Archive', sensitivePaths: 'Potentially sensitive configuration paths',
    sbomComponents: 'Dependency components', sbomPreviewLimit: 'Showing the first 50 components. Download the full inventory.',
    dependencyMatches: 'Advisory matches', dependencyNew: 'New suspected records',
    dependencyScanned: 'Components checked', dependencyUnverified: 'Components with unverified versions', dependencyCoordinate: 'Dependency',
    dependencyAdvisory: 'Advisory', dependencyFixed: 'Recorded fix version', dependencySource: 'Advisory source',
    dependencyMore: 'See the vulnerability inventory for the remaining matches.',
    watchStart: 'Start watching', watchStop: 'Stop watching', watchActive: 'Watching for source changes', watchIdle: 'File watching is off',
    qualityScore: 'Health score', productionMethods: 'Production callables', instability: 'Instability', fanIn: 'Fan in', fanOut: 'Fan out',
    changeCount: 'Changes', hotspotScore: 'Hotspot score', qualitySymbol: 'Symbol', heuristics: 'Review these static call graph candidates against actual execution paths.',
    changeLedger: 'Hunk ledger', changePlanned: 'Planned', changeOmitted: 'Omitted', changeMapping: 'Index mapping',
    changeReason: 'Reason', changeExcerpt: 'Captured evidence', changePreviewLimit: 'Download the snapshot for the complete record.',
    legacyChangeReview: 'Change review snapshot migrated from the legacy instance',
    legacyChangeFindings: 'Legacy finding fingerprints', legacyChangeVulnerabilities: 'Legacy vulnerability IDs',
    LEGACY_CHANGE_PATH_UNAVAILABLE: 'The legacy path could not be resolved within this repository.',
    LEGACY_CHANGE_HUNK_MAPPING_UNAVAILABLE: 'The legacy record lacked a unique unit reference.',
    findingRule: 'Rule', findingSeverity: 'Severity', findingEmpty: 'No external findings for this repository yet.',
    findingRuleVersion: 'Report rule version (optional)', findingFeedback: 'Human feedback', findingFeedbackSave: 'Save feedback',
    findingFeedbackSaved: 'Human feedback saved.', findingFeedbackVersions: 'Supply code and rule versions when importing to reuse feedback.',
    findingDecisionApplied: 'Applied', findingDecisionSkipped: 'Skipped',
    advisoryTitle: 'Model suggestion for human review', advisoryBaseline: 'Baseline assessment',
    advisoryDISABLED: 'The generation model is disabled.', advisoryTIMED_OUT: 'The model review timed out.',
    advisoryFAILED: 'The model review failed.', advisoryBUDGET_EXCEEDED: 'Model review exceeded the budget.',
    advisoryWithoutVerdict: 'The model returned no supported verdict.',
    ADVISORY_INPUT_TRUNCATED: 'Some evidence was omitted due to input scope or budget.',
    ADVISORY_UNKNOWN_CITATIONS: 'Unknown model citations were omitted.',
    ADVISORY_VERDICT_WITHOUT_EVIDENCE: 'The model verdict lacked registered evidence.',
    triageEmpty: 'No triage runs for this repository yet.', triageNoTargets: 'There are no eligible records in this repository.',
    triageStateUnknown: 'The latest status is unavailable. Showing the last recorded steps.', triageStepFailed: 'Failed',
    triageStepPending: 'Pending execution', triageLegacyRun: 'Run migrated from the legacy instance',
    triageLegacyOutputUnavailable: 'The report referenced by this run is unavailable in the current repository.',
    PROCESS_INTERRUPTED: 'The original process was interrupted.', LEGACY_DETAIL_OMITTED: 'The legacy error details were omitted.',
    IMPORT_FINDINGS: 'Read scan report', LOAD_FINDINGS: 'Load imported findings', LOAD_VULNERABILITY: 'Load inventory record',
    BUILD_CONTEXT: 'Build evidence pack', TRIAGE_FINDINGS: 'Build baseline assessment', LLM_ADVISORY: 'Model review', SUBMIT_REVIEW: 'Submit for human review',
    GENERATION_DISABLED: 'The generation model is disabled.', SAST_TRIAGE_ALREADY_RUNNING: 'A triage run is already in progress for this repository.',
    SAST_TRIAGE_QUEUE_FULL: 'The triage queue is full.', NO_REVIEWABLE_FINDINGS: 'The report contains no findings eligible for review.',
    HISTORICAL_FEEDBACK: 'Historical human feedback', RULE_SUPPRESSION: 'Rule suppression',
    TRUE_POSITIVE: 'Confirmed risk', FALSE_POSITIVE: 'Confirmed false positive',
    FINDING_FEEDBACK_VERSION_MISMATCH: 'Reusing feedback requires matching code and rule versions.',
    findingImported: 'Imported', findingDuplicates: 'Duplicates', findingSkipped: 'Skipped', findingTrace: 'Reported trace',
    NEEDS_REVIEW: 'Needs human review', TRUE_RISK: 'Evidence supports a risk', LIKELY_FALSE_POSITIVE: 'Likely false positive',
    FINDING_REPORT_VERSION_UNVERIFIED: 'The report version has not been verified against the current index.',
    FINDING_SYMBOL_FALLBACK: 'Located by the reported symbol.', FINDING_LOCATION_UNINDEXED: 'The location was not found in the current index.',
    FINDING_SOURCE_SINK_TRACE_UNAVAILABLE: 'The report supplies no source-to-sink trace.',
    FINDING_SOURCE_SINK_TRACE_INCOMPLETE: 'The reported trace is incomplete or its order is ambiguous.',
    FINDING_PROTECTION_RUNTIME_UNVERIFIED: 'Review when the protection applies and how it behaves at runtime.',
    PATH_PROTECTION: 'Path protection candidate', findingTracePath: 'Path number',
    SOLIDITY_INDEX_UNAVAILABLE: 'Indexed Solidity evidence is unavailable for this project.',
    MATCHED_DECLARED_VERSION: 'Declared version matches', UNVERIFIED: 'Version unverified',
    queueSelect: 'Select snapshot for export', queueSubmit: 'Submit for human review', queueClaim: 'Claim', queueReturn: 'Return to queue',
    queueConfirm: 'Confirm', queueReject: 'Reject', queueMore: 'View review', queueEmpty: 'No review entries match this filter.', queueAudit: 'Audit history',
    legacyReport: 'Frozen report migrated from the legacy instance', legacyScan: 'Historical scan', queueReportMatches: 'Reports with the same fingerprint',
    scanTasks: 'Scan tasks', scanRuns: 'Tool runs', scanTask: 'Scan task', scanRun: 'Tool run', scanState: 'Status',
    startSemgrep: 'Run Semgrep', startCodeQl: 'Run CodeQL', startSlither: 'Run Slither', cancelScan: 'Cancel scan', retryScan: 'Retry scan',
    SCANNER_NOT_CONFIGURED: 'Semgrep rules are missing from the server configuration', SCANNER_UNAVAILABLE: 'Scanner unavailable',
    CODEQL_NOT_CONFIGURED: 'CodeQL is missing from the server configuration', CODEQL_NO_SUPPORTED_SOURCE: 'No supported source files in the archive',
    SLITHER_NOT_CONFIGURED: 'Slither and the Solidity compiler are missing from the server configuration',
    SLITHER_NO_SUPPORTED_SOURCE: 'No Solidity source files in the archive',
    SLITHER_SOURCE_INCOMPLETE: 'Unable to read Solidity source files', SLITHER_ANALYSIS_FAILED: 'Slither compilation or analysis failed',
    SCANNER_TIMED_OUT: 'The scan timed out', SCAN_CANCELLED: 'The scan was cancelled',
    SCANNER_INCOMPLETE_REPORT: 'Saved the available scan results',
    scanTime: 'Recorded at', scanObservations: 'Captured findings', scanAttempt: 'Attempts', scanBatch: 'Batch', scanAsset: 'Archive asset',
    scanMissingAsset: 'Asset unavailable', scanOriginalState: 'State before interruption', scanToolVersion: 'Tool version', scanExitCode: 'Exit code',
    scanMessage: 'Finding message', LEGACY_SCAN_ERROR_OMITTED: 'Legacy error text was omitted.',
    benchmarkEmpty: 'No saved results yet.', benchmarkSemantic: 'Semantic search', benchmarkCode: 'Code similarity search',
    benchmarkPassed: 'Threshold met', benchmarkFailed: 'Below threshold', benchmarkThreshold: 'Hit@10 threshold', benchmarkQueries: 'Queries',
    benchmarkUnavailable: 'This suite was not provided.', benchmarkNoQueries: 'This suite contains no test queries.',
    benchmarkOnlyMisses: 'Show misses only', benchmarkRank: 'First relevant rank', benchmarkTopResult: 'Top result',
    benchmarkTopScore: 'Top result score', benchmarkHitScore: 'Relevant result score', benchmarkMissed: 'Missed',
    benchmarkRetained: 'Refresh failed. Showing the previous snapshot.', INVALID_BENCHMARK_RESULTS: 'The benchmark report is invalid.',
    SUCCEEDED: 'Succeeded', TIMED_OUT: 'Timed out', UNAVAILABLE: 'Unavailable',
    scanFailed: 'Failed', scanQueued: 'Queued', scanRunning: 'Running',
    IN_REVIEW: 'In review', CONFIRMED: 'Confirmed', SUBMIT: 'Submitted', CLAIM: 'Claimed', RETURN: 'Returned', CONFIRM: 'Confirmed', REJECT: 'Rejected',
    REVIEW_STATE_CONFLICT: 'This entry has changed. Review its current status.', REVIEW_REASON_REQUIRED: 'Enter a reason for the decision.',
    vulnAdd: 'Record as suspected', vulnOpen: 'Open inventory record', vulnEmpty: 'No inventory records match this filter.',
    codeScanComplete: 'Source check complete', codeScanChecked: 'Units checked', codeScanNew: 'New suspected findings',
    taintScanComplete: 'Parameter trace complete', taintScanPartial: 'Saved partial trace results', taintScanChecked: 'Entry points checked',
    CODE_SCAN_INDEX_CHANGED: 'The index changed. Run the source check again.',
    vulnActive: 'Active inventory records', vulnOptionalReason: 'Reason for status change (optional)',
    SUSPECTED: 'Suspected', FIXED: 'Fixed', DISMISSED: 'Dismissed', vulnConfirm: 'Confirm vulnerability', vulnFix: 'Mark fixed', vulnDismiss: 'Dismiss record',
    VULNERABILITY_STATE_CONFLICT: 'This inventory record has changed. Review its current status.',
    INVALID_VULNERABILITY_TRANSITION: 'This action is unavailable for the current status.',
    legacyVulnerability: 'Imported from the legacy inventory', legacyVulnerabilityEvidence: 'Historical evidence',
    taintScanEvidence: 'Parameter-flow evidence',
    legacyEvidenceSOURCE: 'Source', legacyEvidencePROPAGATION: 'Propagation', legacyEvidenceSINK: 'Sink',
    changeModelStart: 'Run model review', changeModelRun: 'Model review', changeModelCancel: 'Cancel run',
    changeAdvisoryOnly: 'For human review', CHANGE_REVIEW_MODEL_UNAVAILABLE: 'Generation model unavailable.',
    CHANGE_VERIFICATION_UNAVAILABLE: 'Isolated verification is unavailable.', CHANGE_REVIEW_INVALID_CITATIONS: 'Unread or unknown citations were omitted.',
    CANCELLED: 'Cancelled', WAITING_FOR_REVIEW: 'Waiting for review', BUILD_CHANGE_REVIEW: 'Retrieve frozen snapshot', REVIEW_UNIT: 'Review unit',
    READ_REVIEW_CONTEXT: 'Read evidence', VERIFY_CHANGE: 'Request verification',
    COMPLETED: 'Complete', PARTIAL: 'Partial', FAILED: 'Review unavailable', MAPPED: 'Mapped', UNMAPPED: 'Not fully mapped',
    PLANNED: 'Planned', OMITTED: 'Omitted', INDEX_VERSION_UNVERIFIED: 'The supplied version labels have not been verified against the index.',
    EXTERNAL_FINDINGS_UNAVAILABLE: 'External findings are unavailable.', INDEX_LINE_CONTENT_DIFFERS: 'Added text differs from the current index.',
    NO_SUPPORTED_MANIFEST: 'No supported manifest in the repository root.',
    BUSINESS: 'Business', TEST: 'Test', DOCUMENTATION: 'Documentation', GENERATED: 'Generated', UNKNOWN: 'Unknown',
    DEPENDENCY_INVENTORY_UNAVAILABLE: 'Dependency inventory unavailable',
    VULNERABILITY_INVENTORY_UNAVAILABLE: 'Vulnerability inventory unavailable',
    SOURCE_HOTSPOTS_UNAVAILABLE: 'Source hotspots unavailable',
    wikiEmpty: 'No Wiki documents yet.', wikiCitations: 'Source references', wikiGenerated: 'Wiki summaries generated.',
    legacyWiki: 'Wiki document migrated from the legacy instance', LEGACY_WIKI_CITATION_UNAVAILABLE: 'Some legacy references lacked usable project paths or line numbers.',
    wikiPartial: 'Some summaries are incomplete. See the generation steps.', wikiFailedRun: 'Wiki generation failed.',
    wikiPending: 'Generation is still running. Refresh this page to resume tracking.', wikiNotes: 'Missing information',
    wikiCurrentIndex: 'Links open source locations in the current index.', QUEUED: 'Queued', RUNNING: 'Running', SKIPPED: 'Skipped',
    WIKI_MODEL_UNAVAILABLE: 'Generation model unavailable.', WIKI_INDEX_RUNNING: 'Wait for indexing to finish.',
    WIKI_ALREADY_RUNNING: 'A Wiki generation is already running for this repository.', WIKI_QUEUE_FULL: 'The Wiki queue is full.',
    WIKI_UNIT_LIMIT: 'Symbol sampling limit reached.', WIKI_MODULE_LIMIT: 'Module sampling limit reached.',
    WIKI_CALL_LIMIT: 'Call sampling limit reached.', WIKI_INDEX_HAS_PENDING_FILES: 'Indexed files are awaiting retry.',
    wikiModelSection: 'Model summary', wikiFactCollection: 'Collect indexed facts', wikiModelGeneration: 'Generate model sections', wikiPersist: 'Save documents', wikiStepFailed: 'Failed',
    'wikiPhase:overview': 'Project overview', 'wikiPhase:modules': 'Module boundaries', 'wikiPhase:entrypoints': 'Entry points and calls',
    'wikiPhase:build': 'Build and runtime', 'wikiPhase:security': 'Security-relevant surfaces',
    WIKI_UNKNOWN_CITATIONS: 'Unknown model citations were omitted.', INVALID_WIKI_SECTION: 'The model returned an invalid section.',
    WIKI_MODEL_DEADLINE: 'The generation time limit was reached.', WIKI_MODEL_SECTIONS_INCOMPLETE: 'Some model sections are unavailable.',
    providerNew: 'New profile', providerSelected: 'Selected', providerKeySaved: 'API key saved',
    providerDeleteConfirm: 'Delete this model profile?', providerModelsFound: 'Models loaded. Select a result or enter a model ID.',
    PROVIDER_CONNECTED: 'Connection and generation succeeded.', PROVIDER_CREDENTIAL_CHANGE_REQUIRED: 'Replace or clear the saved API key when changing the endpoint or protocol.',
    PROVIDER_TIMEOUT: 'The model request timed out.', PROVIDER_REDIRECT_BLOCKED: 'The model endpoint returned a redirect.',
    architectureReady: 'Static evidence collected. Generating the review.', architectureSuggestions: 'Model suggestions',
    architectureDisabled: 'Static evidence collected. Generation is disabled.', architectureFailed: 'Static evidence collected. Model review failed.',
    architectureProblem: 'Problem', architectureSuggestion: 'Suggestion', architectureBenefit: 'Benefit', architectureCost: 'Implementation cost', architectureRisk: 'Risk',
    architectureEvidence: 'Static evidence', architectureUsage: 'Model usage', architecturePriceUnknown: 'Cost unknown',
    evidenceReference: 'Reference', evidenceSummary: 'Summary',
    ARCHITECTURE_UNKNOWN_CITATIONS: 'Unknown model citations were omitted.', ARCHITECTURE_STREAM_FAILED: 'The architecture review connection ended.'
};
const messagesByCode: Record<string, string> = {
    FLOW_TARGET_UNAVAILABLE: 'FLOW_TARGET_UNAVAILABLE', AMBIGUOUS_FLOW_TARGET: 'AMBIGUOUS_FLOW_TARGET', FLOW_ANALYSIS_LIMIT: 'FLOW_ANALYSIS_LIMIT',
    EMBEDDING_DISABLED: 'vectorDisabled', EMBEDDING_UNAVAILABLE: 'vectorUnavailable',
    NO_MATCHING_EVIDENCE: 'noEvidence', CANDIDATE_LIMIT_REACHED: 'candidateLimit',
    INVALID_CREDENTIALS: 'invalidCredentials',
    WIKI_INDEX_RUNNING: 'WIKI_INDEX_RUNNING', WIKI_ALREADY_RUNNING: 'WIKI_ALREADY_RUNNING', WIKI_QUEUE_FULL: 'WIKI_QUEUE_FULL',
    PROVIDER_CREDENTIAL_CHANGE_REQUIRED: 'PROVIDER_CREDENTIAL_CHANGE_REQUIRED', PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
    PROVIDER_REDIRECT_BLOCKED: 'PROVIDER_REDIRECT_BLOCKED', ARCHITECTURE_STREAM_FAILED: 'ARCHITECTURE_STREAM_FAILED',
    REVIEW_STATE_CONFLICT: 'REVIEW_STATE_CONFLICT', REVIEW_REASON_REQUIRED: 'REVIEW_REASON_REQUIRED',
    SAST_TRIAGE_ALREADY_RUNNING: 'SAST_TRIAGE_ALREADY_RUNNING', SAST_TRIAGE_QUEUE_FULL: 'SAST_TRIAGE_QUEUE_FULL',
    VULNERABILITY_STATE_CONFLICT: 'VULNERABILITY_STATE_CONFLICT', INVALID_VULNERABILITY_TRANSITION: 'INVALID_VULNERABILITY_TRANSITION',
    NO_SUPPORTED_MANIFEST: 'NO_SUPPORTED_MANIFEST', DEPENDENCY_INVENTORY_UNAVAILABLE: 'DEPENDENCY_INVENTORY_UNAVAILABLE',
    INVALID_BENCHMARK_RESULTS: 'INVALID_BENCHMARK_RESULTS', CODE_SCAN_INDEX_CHANGED: 'CODE_SCAN_INDEX_CHANGED'
};
const views: View[] = ['repositories', 'overview', 'search', 'graph', 'evidence', 'wiki', 'findings', 'review-queue', 'vulnerabilities',
    'scan-history', 'triage-agent', 'change-review', 'benchmark', 'admin'];
const originals = new Map<Element, string>();
const staticEnglish = new Map<string, string>();
let language: Language = preference('language') === 'zh' || (!preference('language') && navigator.language.startsWith('zh'))
    ? 'zh' : 'en';
let theme = preference('theme') === 'light' ? 'light' : 'dark';
let projects: Project[] = [];
let view: View = 'repositories';
let selected = '';
let connected = false;
let scanHistoryView: ScanHistoryView | undefined;
let benchmarkView: BenchmarkSnapshot | null | undefined;
const benchmarkOpen = new Set<string>();
const benchmarkMisses = new Set<'semantic' | 'code'>();
let flowView: { result: FlowAnalysis; nodeId: string; includeDependencies: boolean; projectId: string } | undefined;
let account: Account | undefined;
let administration: Administration | undefined;
let organizationMembers: Account[] = [];
let nextPage: { path: string; args: Record<string, string>; offset: number } | undefined;
let indexRequest: AbortController | undefined;
let archiveRequest: AbortController | undefined;
let sourceFocus: HTMLElement | null = null;
let overview: ProjectStats | undefined;
let watchState: boolean | undefined;
let watchBusy = false;
type QualityMeasure = 'report' | 'complexity' | 'coupling' | 'cycles' | 'hotspots' | 'deadcode' | 'testgaps' | 'architecture';
const qualityPaths: Record<QualityMeasure, string> = {
    report: '/metrics/report', complexity: '/metrics/complexity', coupling: '/metrics/coupling', cycles: '/metrics/cycles',
    hotspots: '/metrics/hotspots', deadcode: '/graph/deadcode', testgaps: '/graph/testgaps', architecture: '/architecture/reviews/stream'
};
const modelProvidersPath = '/admin/model-providers';
const providerTemplates: Record<GenerationProtocol, string> = {
    OLLAMA: 'http://localhost:11434', OPENAI: 'https://api.openai.com/v1', OPENAI_COMPATIBLE: '', ANTHROPIC: 'https://api.anthropic.com/v1'
};
let providers: ModelProvider[] = [];
let quality: { measure: QualityMeasure; result: unknown } | undefined;
let changeSnapshot: ChangeSnapshot | undefined;
let changeRun: AgentRun | undefined;
let triageRuns: AgentRun[] = [];
let triageRun: AgentRun | undefined;
let focusTriageRun = '';
const triageSteps = new Map<string, { node: HTMLDetailsElement; state: string }>();
let findingList: FindingList | undefined;
let findingDetail: FindingDetail | undefined;
let queuePage: QueuePage | undefined;
let queueDetail: { snapshot: QueueView['snapshot']; item: QueueView['items'][number]; audit: QueueAudit } | undefined;
const advisoryResults = new Map<AdvisoryPanel, TriageAdvisory>();
const queueSelected = new Set<string>();
let vulnPage: { items: VulnerabilityFinding[]; offset: number } | undefined;
let vulnDetail: VulnerabilityDetail | undefined;
const vulnPageSize = 25;
let wikiSummary: { tree: WikiNode[]; document: SummaryDocument } | undefined;
let wikiRun: AgentRun | undefined;
let sbom: Sbom | undefined;
let dependencyScan: DependencyScanResult | undefined;
let archiveOverview: { asset: ArchiveAsset; profile?: ArchiveProfile } | undefined;
const controllers = new Map<string, AbortController>();
const notes = new Map<string, { key: string; detail: string; kind?: Severity }>();

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
function input(id: string) { return element<HTMLInputElement>(id); }
function select(id: string) { return element<HTMLSelectElement>(id); }
function el(tag: string, text = '', className = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
}
function preference(key: string, value?: string) {
    const name = `repograph.${key}`;
    try {
        if (value !== undefined) localStorage.setItem(name, value);
        return localStorage.getItem(name);
    } catch { return null; }
}
function t(key: string) {
    return (language === 'zh' ? zh[key] : englishDynamic[key]) ?? staticEnglish.get(key) ?? key;
}
function report(id: string, key = '', detail = '', kind?: Severity) {
    const node = element(id);
    node.hidden = !key;
    if (!key) {
        notes.delete(id);
        return;
    }
    notes.set(id, { key, detail, kind });
    node.textContent = key === 'matches' ? `${detail} ${t(detail === '1' ? 'match' : 'matches')}`
        : [t(key), detail].filter(Boolean).join(' · ');
    node.dataset.kind = kind ?? '';
}
function localize() {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.documentElement.dataset.theme = theme;
    for (const [node, original] of originals) {
        const item = node as HTMLElement;
        if (item.dataset.text) item.textContent = language === 'zh' ? zh[item.dataset.text] ?? original : original;
        else if (item.dataset.placeholder) item.setAttribute('placeholder', language === 'zh' ? zh[item.dataset.placeholder] ?? original : original);
        else if (item.dataset.aria) item.setAttribute('aria-label', language === 'zh' ? zh[item.dataset.aria] ?? original : original);
    }
    element('theme').textContent = t(theme === 'dark' ? 'light' : 'dark');
    element('language').textContent = language === 'en' ? '中文' : 'English';
    element('language').setAttribute('aria-label', language === 'en' ? 'Switch to Chinese' : '切换为英文');
    element('current-view').textContent = t(view);
    for (const [id, note] of notes) report(id, note.key, note.detail, note.kind);
    for (const button of document.querySelectorAll<HTMLElement>('[data-label]')) button.textContent = t(button.dataset.label!);
    if (view === 'overview' && overview) renderOverview(overview);
    renderWatch();
    if (view === 'overview' && quality) renderQuality(quality.measure, quality.result);
    if (view === 'change-review' && changeSnapshot) renderChangeReview(changeSnapshot);
    if (view === 'change-review' && changeRun) renderChangeRun(changeRun);
    if (view === 'triage-agent') {
        renderTriageList();
        renderTriageControls();
        if (triageRun) renderTriageRun(triageRun);
    }
    if (view === 'findings' && findingList) renderFindingList(findingList);
    if (view === 'findings' && findingDetail) renderFindingDetail(findingDetail);
    if (view === 'scan-history' && scanHistoryView) renderScanHistory(scanHistoryView);
    if (view === 'benchmark' && benchmarkView !== undefined) renderBenchmark(benchmarkView);
    if (view === 'review-queue' && queuePage) renderQueuePage(queuePage);
    if (view === 'review-queue' && queueDetail) renderQueueDetail(queueDetail);
    if (view === 'vulnerabilities' && vulnPage) renderVulnerabilities(vulnPage);
    if (view === 'vulnerabilities' && vulnDetail) renderVulnerabilityDetail(vulnDetail);
    if (view === 'wiki' && wikiSummary) renderWiki(wikiSummary.tree, wikiSummary.document);
    if (view === 'wiki' && wikiRun) renderWikiRun(wikiRun);
    if (view === 'overview' && sbom) renderSbom(sbom);
    if (view === 'overview' && dependencyScan) renderDependencyScan(dependencyScan);
    if (view === 'graph' && flowView) renderFlow(flowView);
    if (view === 'overview' && archiveOverview) renderArchiveProfile(archiveOverview.asset, archiveOverview.profile);
    if (view === 'admin' && administration) renderAdministration(administration);
    if (view === 'admin' && providers.length) renderProviderChoices();
    renderProjects();
}
for (const item of document.querySelectorAll<HTMLElement>('[data-text], [data-placeholder], [data-aria]')) {
    const original = item.dataset.text ? item.textContent?.trim()
        : item.getAttribute(item.dataset.placeholder ? 'placeholder' : 'aria-label');
    originals.set(item, original ?? '');
    if (item.dataset.text && original) staticEnglish.set(item.dataset.text, original);
}

class RequestError extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
}

async function api<T>(
    path: string, args: Record<string, string> = {}, init: RequestInit = {}, expected: 'json' | 'text' | 'blob' = 'json'
): Promise<T> {
    const url = new URL(`/api/v1${path}`, location.origin);
    for (const [key, value] of Object.entries(args)) url.searchParams.set(key, value);
    const headers = new Headers(init.headers);
    if (init.method && init.method !== 'GET' && !(path === '/web/session' && init.method === 'POST')) {
        const csrf = await api<{ token: string; headerName: string }>('/auth/csrf', {}, { signal: init.signal });
        headers.set(csrf.headerName, csrf.token);
    }
    const response = await fetch(url, { ...init, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    if (response.status === 204) return undefined as T;
    if (expected === 'text' && response.ok) return await response.text() as T;
    if (expected === 'blob' && response.ok) return await response.blob() as T;
    const body = await response.json();
    if (!response.ok) throw new RequestError(response.status, typeof body.error === 'string' ? body.error : 'REQUEST_FAILED');
    return body as T;
}

function jsonRequest(payload: unknown, method = 'POST', signal?: AbortSignal): RequestInit {
    return { method, signal, body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } };
}

function showFailure(id: string, error: unknown) {
    if (error instanceof RequestError) {
        if (error.status === 401 && connected) {
            showLogin('expired');
            return;
        }
        const known = messagesByCode[error.code];
        report(id, known ?? 'failed', known ? '' : error.code, 'error');
    } else report(id, 'noNetwork', '', 'error');
}

async function run<T>(key: string, task: (signal: AbortSignal) => Promise<T>, success: (result: T) => void) {
    controllers.get(key)?.abort();
    const controller = new AbortController();
    controllers.set(key, controller);
    const status = `${key}-status`;
    report(status, 'load');
    try {
        const result = await task(controller.signal);
        if (!controller.signal.aborted) success(result);
    } catch (error) {
        if (!controller.signal.aborted) showFailure(status, error);
    } finally {
        if (controllers.get(key) === controller) controllers.delete(key);
    }
}

function closeMenu() {
    element('sidebar').classList.remove('open');
    element('menu').setAttribute('aria-expanded', 'false');
}
function route(view: View, project: string, params: Record<string, string> = {}) {
    const query = new URLSearchParams({ ...(view === 'repositories' ? {} : { view }), ...params });
    if (project) query.set('project', project);
    return query.size ? `/?${query}` : '/';
}
function isUuid(value: string | null): value is string {
    return !!value && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
}
function navigate(next: View, project = selected, params: Record<string, string> = {}) {
    history.pushState(null, '', route(next, project, params));
    readRoute();
}
function readRoute() {
    const params = new URL(location.href).searchParams;
    const hash = location.hash.slice(1);
    const legacy = /^(?:stats|search|graph|symbol|index|tools|agent|wiki|benchmark)(?:[=/:?](?:projectId=)?([a-f0-9]{12}))?$/.exec(hash);
    const oldView: View = hash.startsWith('stats') ? 'overview' : hash.startsWith('search') ? 'search'
        : /^(graph|symbol)/.test(hash) ? 'graph' : hash.startsWith('agent') ? 'triage-agent' : hash.startsWith('wiki') ? 'wiki'
        : hash.startsWith('benchmark') ? 'benchmark' : 'repositories';
    const requested = params.get('view') as View | null;
    const destination = requested && views.includes(requested) && (requested !== 'admin' || account?.role === 'ADMIN')
        ? requested : legacy ? oldView : 'repositories';
    const project = params.get('project') ?? legacy?.[1] ?? '';
    const previous = view;
    if (previous === 'admin' && destination !== 'admin') input('provider-key').value = '';
    if (selected !== project || view !== destination) {
        for (const [key, controller] of controllers) {
            if (key === 'repositories' || (key === 'benchmark' && previous === destination)) continue;
            controller.abort();
            if (notes.get(`${key}-status`)?.key === 'load') report(`${key}-status`);
        }
        if (selected !== project) {
            flowView = undefined;
            for (const panel of ['search', 'graph', 'evidence']) {
                element(`${panel}-results`).replaceChildren();
                report(`${panel}-status`);
            }
            report('locate-status');
            nextPage = undefined;
            element('next').hidden = true;
            resetWiki();
            resetFindings();
            resetScanHistory();
            resetQueue();
            resetVulnerabilities();
            resetTriage();
        }
        if (element<HTMLDialogElement>('source-dialog').open) element<HTMLDialogElement>('source-dialog').close();
    }
    selected = /^[a-f0-9]{12}$/.test(project) ? project : '';
    view = destination;
    for (const name of views) element(`view-${name}`).hidden = name !== view;
    for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a[data-view]')) {
        if (link.dataset.view === (view === 'overview' ? 'repositories' : view)) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        link.href = route(link.dataset.view as View, selected);
    }
    element('current-view').textContent = t(view);
    closeMenu();
    renderProjects();
    if (view === 'search') element('next').hidden = !nextPage;
    if (previous !== view) {
        const heading = element(`${view}-title`);
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
    }
    if (connected && view === 'overview') loadOverview();
    if (connected && view === 'change-review') loadChangeReview(params.get('snapshot'), params.get('run'));
    if (connected && view === 'triage-agent') loadTriageWorkspace(params);
    if (connected && view === 'findings') {
        loadFindings(findingList?.offset ?? 0);
        loadFindingDetail(params.get('finding'));
    }
    if (connected && view === 'scan-history') loadScanHistory(params);
    if (connected && view === 'benchmark' && (previous !== view || (benchmarkView === undefined && !controllers.has('benchmark')))) {
        void loadBenchmark();
    }
    if (connected && view === 'review-queue') {
        controllers.get('queue-transition')?.abort();
        loadQueue(queuePage?.page ?? 0);
        loadQueueDetail(params.get('snapshot'), params.get('entry'));
    }
    if (connected && view === 'vulnerabilities') {
        controllers.get('vuln-transition')?.abort();
        loadVulnerabilities(vulnPage?.offset ?? 0);
        loadVulnerabilityDetail(params.get('vulnerability'));
    }
    if (connected && view === 'wiki') {
        loadWiki(params.get('document'));
        const runId = params.get('run');
        if (isUuid(runId)) void trackWiki(runId);
    }
    if (connected && view === 'admin') loadAdministration();
    if (connected && view === 'graph') {
        const file = params.get('file');
        const line = Number(params.get('line'));
        const target = params.get('target');
        if (file && Number.isSafeInteger(line) && line > 0) {
            input('file').value = file;
            input('line').value = String(line);
            input('locate-archive-entry').value = params.get('archiveEntry') ?? '';
            syncLocateArchive();
            element<HTMLDetailsElement>('locate-form').closest('details')?.setAttribute('open', '');
            locate(file, line, selected, input('locate-archive-entry').value);
        } else if (target) {
            input('target').value = target;
            trace();
        }
    }
}

function resultButton(label: string, action: () => void) {
    const control = el('button', t(label)) as HTMLButtonElement;
    control.type = 'button';
    control.dataset.label = label;
    control.addEventListener('click', action);
    return control;
}

function renderProjects() {
    const list = element('repository-list');
    if (!list) return;
    const projectControl = select('project');
    projectControl.replaceChildren(new Option(t('choose'), ''), ...projects.map(project =>
        new Option(project.projectName || project.projectId, project.projectId)));
    projectControl.value = selected;
    element('repo-count').textContent = String(projects.length);
    if (!projects.length) {
        list.replaceChildren(el('p', t('emptyRepos'), 'empty'));
        return;
    }
    list.replaceChildren(...projects.map(project => {
        const article = el('article', '', `repo-row${selected === project.projectId ? ' current' : ''}`);
        const description = el('div');
        description.append(el('h3', project.projectName || project.projectId), el('p', project.projectRoot, 'mono'));
        const metrics = el('div', '', 'repo-meta');
        metrics.append(el('span', `${project.nodeCount} ${t('units')}`), el('span', project.projectId, 'mono'));
        if (project.assetId) metrics.append(el('span', t('assetsArchive'), 'kind'));
        if (project.indexedAt) metrics.append(el('time', new Date(project.indexedAt).toLocaleString(language)));
        description.append(metrics);
        const actions = el('div', '', 'row-actions');
        actions.append(resultButton('overview', () => navigate('overview', project.projectId)), resultButton('openSearch', () => {
            select('search-scope').value = 'current';
            navigate('search', project.projectId);
        }));
        if (account?.role === 'ADMIN') {
            if (!project.assetId) actions.append(resultButton('indexRepository', () => {
                input('directory').value = project.projectRoot;
                input('directory').focus();
            }));
            actions.append(resultButton(project.assetId ? 'removeArchive' : 'remove', () => {
                if (!confirm(t(project.assetId ? 'removeArchiveConfirm' : 'removeConfirm'))) return;
                void run('repositories', signal => api('/index/project', { projectId: project.projectId }, { method: 'DELETE', signal }), () => {
                    if (selected === project.projectId) navigate('repositories', '');
                    void refreshProjects();
                });
            }));
        }
        article.append(description, actions);
        return article;
    }));
}

function refreshProjects() {
    return run('repositories', signal => api<Project[]>('/projects', {}, { signal }), result => {
        projects = result;
        if (account?.role === 'USER' && selected && !projects.some(project => project.projectId === selected)) {
            navigate(view, '');
        }
        renderProjects();
        report('repositories-status');
    });
}

function loadOverview() {
    overview = undefined;
    resetQuality();
    watchState = undefined;
    watchBusy = false;
    report('watch-status');
    renderWatch();
    resetSbom();
    element('overview-data').replaceChildren();
    element('overview-root').textContent = '';
    element('archive-profile').hidden = true;
    element('profile-content').replaceChildren();
    report('profile-status');
    archiveOverview = undefined;
    if (!selected) {
        report('overview-status', 'pickFirst', '', 'warning');
        return;
    }
    const projectId = selected;
    const project = projects.find(item => item.projectId === projectId);
    if (project?.assetId) loadArchiveProfile(project.assetId);
    else if (project) void run('watch', signal => api<{ watching: boolean }>(`/watch/${projectId}`, {}, { signal }), result => {
        watchState = result.watching;
        renderWatch();
        report('watch-status');
    });
    void run('overview', signal => api<ProjectStats>(`/projects/${projectId}/stats`, {}, { signal }), data => {
        overview = data;
        renderOverview(data);
    });
}

function renderWatch() {
    const project = projects.find(item => item.projectId === selected);
    const show = connected && view === 'overview' && !!project && !project.assetId && watchState !== undefined;
    element('watch-controls').hidden = !show;
    const control = element<HTMLButtonElement>('watch-toggle');
    control.hidden = !show || account?.role !== 'ADMIN';
    control.disabled = watchBusy;
    control.textContent = t(watchState ? 'watchStop' : 'watchStart');
    element('watch-state').textContent = show ? t(watchState ? 'watchActive' : 'watchIdle') : '';
}

function renderOverview(data: ProjectStats) {
    const content = element('overview-data');
    element('overview-root').textContent = data.projectRoot;
    if (!data.projectRoot) {
        report('overview-status', 'noResults');
        return;
    }
    report('overview-status');
    element('quality-panel').hidden = false;
    element('sbom-section').hidden = false;
    const metrics = el('div', '', 'metrics');
    for (const [name, count] of [
        ['allFiles', data.totalFiles], ['allUnits', data.totalUnits], ['allRelations', data.totalEdges],
        ['testUnits', data.testCount], ['entryPoints', data.entryPointCount]
    ] as const) {
        const metric = el('section', '', 'surface metric');
        metric.append(el('h2', t(name)), el('strong', String(count)));
        metrics.append(metric);
    }
    const distributions = el('div', '', 'distributions');
    for (const [name, distribution] of [
        ['languageBreakdown', data.languageDistribution], ['symbolKinds', data.kindDistribution],
        ['relationKinds', data.edgeKindDistribution], ['frameworks', data.frameworkDistribution]
    ] as const) {
        const rows = Object.entries(distribution).sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b));
        if (!rows.length) continue;
        const panel = el('section', '', 'surface distribution');
        panel.append(el('h2', t(name)));
        const maximum = rows[0][1];
        for (const [label, count] of rows) {
            const row = el('div', '', 'distribution-row');
            const meter = el('meter') as HTMLMeterElement;
            meter.max = maximum;
            meter.value = count;
            meter.setAttribute('aria-label', label);
            row.append(el('span', label), meter, el('strong', String(count)));
            panel.append(row);
        }
        distributions.append(panel);
    }
    content.replaceChildren(metrics, distributions);
}

function resetQuality() {
    quality = undefined;
    element('quality-panel').hidden = true;
    element<HTMLDetailsElement>('quality-panel').open = false;
    element('quality-content').replaceChildren();
    report('quality-status');
    report('graph-export-status');
}

function qualityTable(headings: string[], rows: (string | Node)[][]) {
    if (!rows.length) return el('p', t('noResults'), 'empty');
    const frame = el('div', '', 'quality-table');
    const table = el('table') as HTMLTableElement;
    const header = table.createTHead().insertRow();
    for (const heading of headings) {
        const cell = el('th', t(heading)) as HTMLTableCellElement;
        cell.scope = 'col';
        header.append(cell);
    }
    const body = table.createTBody();
    for (const row of rows) {
        const item = body.insertRow();
        for (const value of row) item.insertCell().append(value);
    }
    frame.append(table);
    return frame;
}

const scanHistoryPageSize = 25;
function resetScanHistory() {
    controllers.get('scan-history')?.abort();
    scanHistoryView = undefined;
    element('scan-history-content').replaceChildren();
    report('scan-history-status');
}

function loadScanHistory(params: URLSearchParams) {
    resetScanHistory();
    const projectId = selected;
    if (!projectId) { report('scan-history-status', 'pickFirst', '', 'warning'); return; }
    const validId = (key: string) => {
        const id = params.get(key) ?? '';
        return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : '';
    };
    const readPage = (name: string) => {
        const page = Number(params.get(name));
        return Number.isSafeInteger(page) ? Math.min(Math.max(0, page), 100_000) : 0;
    };
    const taskId = validId('task');
    const runId = validId('scan');
    const findingsPage = readPage('findingsPage');
    const scopedPage = (page: number) => ({ projectId, page: String(page), size: String(scanHistoryPageSize) });
    void run('scan-history', async (signal): Promise<ScanHistoryView> => {
        if (taskId) {
            const path = '/scan-tasks/' + taskId;
            let task = await api<ArchivedScanTask>(path, { projectId }, { signal });
            const readObservations = () => api<ScanFindingsPage>(path + '/findings', scopedPage(findingsPage), { signal });
            if (activeScan(task)) {
                const observations = await readObservations();
                signal.throwIfAborted();
                scanHistoryView = { projectId, type: 'task', task, observations };
                renderScanHistory(scanHistoryView);
                while (activeScan(task)) {
                    report('scan-history-status', task.status === 'RUNNING' ? 'scanRunning' : 'scanQueued');
                    await new Promise(resolve => setTimeout(resolve, 750));
                    signal.throwIfAborted();
                    task = await api<ArchivedScanTask>(path, { projectId }, { signal });
                }
            }
            const observations = await readObservations();
            return { projectId, type: 'task', task, observations };
        }
        if (runId) {
            const result = await api<ArchivedScannerRun>('/scans/' + runId, { projectId }, { signal });
            return { projectId, type: 'run', run: result, page: findingsPage };
        }
        const [tasks, runs] = await Promise.all([
            api<ScanHistoryPage<ArchivedScanTask>>('/scan-tasks', scopedPage(readPage('tasksPage')), { signal }),
            api<ScanHistoryPage<ArchivedScannerSummary>>('/scans', scopedPage(readPage('runsPage')), { signal })
        ]);
        return { projectId, type: 'index', tasks, runs };
    }, result => {
        const focus = document.activeElement;
        const focusedLink = focus instanceof HTMLAnchorElement && element('scan-history-content').contains(focus) ? focus.href : '';
        scanHistoryView = result;
        renderScanHistory(result);
        if (focusedLink) Array.from(element('scan-history-content').querySelectorAll('a')).find(link => link.href === focusedLink)
            ?.focus({ preventScroll: true });
        report('scan-history-status');
    });
}

function activeScan(task: ArchivedScanTask) { return task.status === 'QUEUED' || task.status === 'RUNNING'; }

function scanHistoryLink(label: string, projectId: string, params: Record<string, string> = {}) {
    const link = el('a', label) as HTMLAnchorElement;
    link.href = route('scan-history', projectId, params);
    link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        navigate('scan-history', projectId, params);
    });
    return link;
}

function scanHistoryPager(projectId: string, paging: { page: number; size: number; total: number },
    key: string, params: Record<string, string>) {
    const { page, size, total } = paging;
    const controls = el('div', '', 'finding-list-nav');
    const move = (destination: number) => navigate('scan-history', projectId, { ...params, [key]: String(destination) });
    const previous = resultButton('findingPrevious', () => move(page - 1));
    const next = resultButton('findingNext', () => move(page + 1));
    previous.disabled = page === 0;
    next.disabled = (page + 1) * size >= total;
    controls.hidden = previous.disabled && next.disabled;
    controls.append(previous, next);
    return controls;
}

function renderScanHistory(history: ScanHistoryView) {
    const { projectId } = history;
    const content = element('scan-history-content');
    const status = (state: string) => t(({ FAILED: 'scanFailed', QUEUED: 'scanQueued', RUNNING: 'scanRunning' } as Record<string, string>)[state] ?? state);
    const date = (time: string) => new Date(time).toLocaleString(language);
    const section = (title: string, ...children: Node[]) => {
        const panel = el('section', '', 'surface stack scan-history-panel');
        panel.append(el('h2', t(title)), ...children);
        return panel;
    };
    const runRows = (entries: ArchivedScannerSummary[]) => entries.map(item => [
        scanHistoryLink(item.scanner + ' · ' + item.scanId, projectId, { scan: item.scanId }),
        status(item.status), date(item.startedAt), String(item.findingCount)
    ]);
    if (history.type === 'index') {
        const { tasks, runs } = history;
        const taskRows = tasks.entries.map(task => [
            scanHistoryLink(task.id, projectId, { task: task.id }), status(task.status), date(task.updatedAt), String(task.findingCount)
        ]);
        content.replaceChildren(
            section('scanTasks', qualityTable(['scanTask', 'scanState', 'scanTime', 'scanObservations'], taskRows),
                scanHistoryPager(projectId, tasks, 'tasksPage', { runsPage: String(runs.page) })),
            section('scanRuns', qualityTable(['scanRun', 'scanState', 'scanTime', 'scanObservations'], runRows(runs.entries)),
                scanHistoryPager(projectId, runs, 'runsPage', { tasksPage: String(tasks.page) }))
        );
        return;
    }
    const back = el('div', '', 'change-actions');
    back.append(scanHistoryLink(t('scan-history'), projectId));
    content.replaceChildren(back);
    const observations = (findings: ExternalFinding[], paging: { page: number; size: number; total: number }, params: Record<string, string>) =>
        section('scanObservations', qualityTable(['findingRule', 'file', 'findingSeverity', 'scanMessage'], findings.map(finding => [
            finding.ruleId, evidenceLocation(finding.filePath, finding.startLine, finding.endLine), finding.severity, finding.message
        ])), scanHistoryPager(projectId, paging, 'findingsPage', params));
    if (history.type === 'task') {
        const { task, observations: page } = history;
        const metadata = qualityTable(['scanTask', 'scanState', 'scanTime', 'scanAttempt', 'scanBatch'], [[
            task.id, status(task.status), date(task.updatedAt), String(task.attempt), task.batchId || '—'
        ]]);
        const detail = section('scanTask', metadata);
        if (task.assetId) detail.append(el('p', [t(task.assetAvailable ? 'scanAsset' : 'scanMissingAsset'), task.assetId].join(' · '), 'hint'));
        if (task.originalStatus) detail.append(el('p', [t('scanOriginalState'), status(task.originalStatus)].join(' · '), 'hint'));
        if (task.error) detail.append(el('p', t(task.error), 'hint'));
        const action = activeScan(task) ? 'cancel' : ['FAILED', 'PARTIAL', 'CANCELLED'].includes(task.status) ? 'retry' : null;
        if (task.execution === 'LOCAL' && action) {
            const button = resultButton(action === 'cancel' ? 'cancelScan' : 'retryScan', () => {
                button.disabled = true;
                const params = new URL(location.href).searchParams;
                void run('scan-history',
                    signal => api('/scan-tasks/' + task.id + '/' + action, { projectId }, { method: 'POST', signal }),
                    () => loadScanHistory(params)).finally(() => { button.disabled = false; });
            });
            detail.append(button);
        }
        content.append(detail, section('scanRuns', qualityTable(['scanRun', 'scanState', 'scanTime', 'scanObservations'], runRows(task.scanners))),
            observations(page.findings, page, { task: task.id }));
        return;
    }
    const { run: scanRun, page } = history;
    const metadata = qualityTable(['scanRun', 'scanState', 'scanTime', 'scanToolVersion', 'scanExitCode', 'scanBatch'], [[
        scanRun.scanner + ' · ' + scanRun.scanId, status(scanRun.status), date(scanRun.startedAt),
        scanRun.toolVersion || '—', String(scanRun.exitCode), scanRun.batchId || '—'
    ]]);
    const detail = section('scanRun', metadata);
    if (scanRun.error) detail.append(el('p', t(scanRun.error), 'hint'));
    const offset = page * scanHistoryPageSize;
    content.append(detail, observations(scanRun.findings.slice(offset, offset + scanHistoryPageSize),
        { page, size: scanHistoryPageSize, total: scanRun.findingCount }, { scan: scanRun.scanId }));
}

async function loadBenchmark() {
    controllers.get('benchmark')?.abort();
    const controller = new AbortController();
    controllers.set('benchmark', controller);
    const content = element('benchmark-content');
    content.setAttribute('aria-busy', 'true');
    report('benchmark-status', 'load');
    try {
        const snapshot = await api<BenchmarkSnapshot>('/benchmark/results', {}, { signal: controller.signal }).catch(error => {
            if (error instanceof RequestError && error.status === 404) return null;
            throw error;
        });
        if (controller.signal.aborted) return;
        benchmarkView = snapshot;
        renderBenchmark(snapshot);
        report('benchmark-status');
    } catch (error) {
        if (controller.signal.aborted) return;
        if (benchmarkView && !(error instanceof RequestError && error.status === 401)) {
            const reason = error instanceof RequestError ? error.code : '';
            report('benchmark-status', 'benchmarkRetained', reason, 'warning');
        } else showFailure('benchmark-status', error);
    } finally {
        if (controllers.get('benchmark') === controller) {
            controllers.delete('benchmark');
            content.setAttribute('aria-busy', 'false');
        }
    }
}

function renderBenchmark(snapshot: BenchmarkSnapshot | null) {
    const content = element('benchmark-content');
    const focus = (document.activeElement as HTMLElement | null)?.dataset.benchmarkFocus;
    if (!snapshot) {
        benchmarkOpen.clear();
        benchmarkMisses.clear();
        content.replaceChildren(el('p', t('benchmarkEmpty'), 'empty'));
        return;
    }
    rememberOpenBenchmarkCases(content);
    const origin = el('p', [snapshot.projectLabel, snapshot.embedding?.model, snapshot.generatedAt].filter(Boolean).join(' · '), 'benchmark-origin hint');
    content.replaceChildren(origin, renderBenchmarkSuite('semantic', snapshot.semantic), renderBenchmarkSuite('code', snapshot.code));
    if (focus) {
        const target = [...content.querySelectorAll<HTMLElement>('[data-benchmark-focus]')].find(node => node.dataset.benchmarkFocus === focus);
        target?.focus({ preventScroll: true });
    }
}

function rememberOpenBenchmarkCases(container: HTMLElement) {
    for (const detail of container.querySelectorAll<HTMLDetailsElement>('details[data-benchmark-case]')) {
        const key = detail.dataset.benchmarkCase!;
        if (detail.open) benchmarkOpen.add(key);
        else benchmarkOpen.delete(key);
    }
}

function renderBenchmarkSuite(mode: 'semantic' | 'code', suite: BenchmarkSuite | undefined) {
    const panel = el('section', '', 'surface stack benchmark-panel');
    panel.append(el('h2', t(mode === 'semantic' ? 'benchmarkSemantic' : 'benchmarkCode')));
    if (!suite?.total) {
        panel.append(el('p', t(suite ? 'benchmarkNoQueries' : 'benchmarkUnavailable'), 'hint'));
        return panel;
    }
    const percent = new Intl.NumberFormat(language, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const score = new Intl.NumberFormat(language, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const metric = (label: string, value: string) => [el('dt', t(label)), el('dd', value)];
    const hitRate = qualityTable(['Hit@1', 'Hit@3', 'Hit@5', 'Hit@10', 'MRR@10'], [[
        ...[suite.hit1Rate, suite.hit3Rate, suite.hit5Rate, suite.hit10Rate].map(value => percent.format(value)), score.format(suite.mrr10)
    ]]);
    const gate = el('p', [t(suite.passed ? 'benchmarkPassed' : 'benchmarkFailed'),
        t('benchmarkThreshold') + ' ' + percent.format(suite.threshold), String(suite.total) + ' ' + t('benchmarkQueries')].join(' · '), 'hint');
    const filter = el('input') as HTMLInputElement;
    filter.type = 'checkbox';
    filter.checked = benchmarkMisses.has(mode);
    filter.dataset.benchmarkFocus = mode;
    const label = el('label', '', 'benchmark-filter');
    label.append(filter, document.createTextNode(t('benchmarkOnlyMisses')));
    const list = el('div');
    const renderCases = () => {
        rememberOpenBenchmarkCases(list);
        const cases = filter.checked ? suite.cases.filter(entry => !entry.hit10) : suite.cases;
        list.replaceChildren(...cases.map(entry => {
            const key = mode + '/' + entry.id;
            const detail = el('details', '', 'benchmark-case') as HTMLDetailsElement;
            detail.dataset.benchmarkCase = key;
            detail.open = benchmarkOpen.has(key);
            const summary = el('summary', entry.id + ' · ' + entry.description);
            summary.dataset.benchmarkFocus = key;
            const facts = el('dl', '', 'benchmark-facts');
            facts.append(...metric('benchmarkRank', entry.rank ? String(entry.rank) : t('benchmarkMissed')),
                ...metric('benchmarkTopResult', entry.topResult || '—'),
                ...metric('benchmarkTopScore', entry.topScore === null || !entry.topResult ? '—' : score.format(entry.topScore)),
                ...metric('benchmarkHitScore', entry.hitScore === null || !entry.rank ? '—' : score.format(entry.hitScore)));
            detail.append(summary, facts);
            return detail;
        }));
        if (!cases.length) list.append(el('p', t('noResults'), 'empty'));
    };
    filter.addEventListener('change', () => {
        if (filter.checked) benchmarkMisses.add(mode);
        else benchmarkMisses.delete(mode);
        renderCases();
    });
    renderCases();
    panel.append(gate, hitRate, label, list);
    return panel;
}

function renderQuality(measure: QualityMeasure, data: unknown) {
    const content = element('quality-content');
    if (measure === 'architecture') { renderArchitecture(content, data as ArchitectureReview); return; }
    function location(item: { filePath: string; startLine: number; qualifiedName: string }) {
        const link = el('a', item.qualifiedName) as HTMLAnchorElement;
        link.href = route('graph', selected, { file: item.filePath, line: String(item.startLine) });
        return link;
    }
    const complexityTable = (items: ComplexityMetric[]) => qualityTable(['qualitySymbol', 'file', 'qualityComplexity'], items.map(item =>
        [location(item), item.filePath + ':' + item.startLine, String(item.complexity)]));
    type Report = ReturnType<CodeMetrics['report']>;
    const couplingTable = (items: Report['topInstableCouplings']) => qualityTable(['qualitySymbol', 'file', 'fanIn', 'fanOut', 'instability'], items.map(item =>
        [location({ ...item, qualifiedName: item.classQualifiedName }), item.filePath + ':' + item.startLine,
            String(item.fanIn), String(item.fanOut), String(item.instability)]));
    const cycleTable = (items: PackageCycle[]) => qualityTable(['qualityCycles'], items.map(item => [item.packages.join(' · ')]));
    switch (measure) {
        case 'report': {
            const value = data as Report;
            content.replaceChildren(qualityTable(['qualityScore', 'productionMethods', 'qualityCycles', 'qualityDead', 'qualityGaps'],
                [[value.healthScore + ' / 100', String(value.totalProductionMethods), String(value.packageCycles), String(value.deadCodeCount),
                    String(value.testGapCount)]]));
            for (const reason of value.omittedReasons) content.append(el('p', t(reason), 'hint'));
            content.append(el('h3', t('vulnActive')), qualityTable(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
                [[value.vulnCritical, value.vulnHigh, value.vulnMedium, value.vulnLow].map(String)]));
            if (value.topComplexMethods.length) content.append(el('h3', t('qualityComplexity')), complexityTable(value.topComplexMethods));
            if (value.topInstableCouplings.length) content.append(el('h3', t('qualityCoupling')), couplingTable(value.topInstableCouplings));
            if (value.packageCycleList.length) content.append(cycleTable(value.packageCycleList));
            break;
        }
        case 'complexity': content.replaceChildren(complexityTable(data as ComplexityMetric[])); break;
        case 'coupling': content.replaceChildren(couplingTable(data as Report['topInstableCouplings'])); break;
        case 'cycles': content.replaceChildren(cycleTable(data as PackageCycle[])); break;
        case 'hotspots': content.replaceChildren(qualityTable(['file', 'changeCount', 'qualityComplexity', 'hotspotScore'],
            (data as ReturnType<typeof sourceHotspots>).map(item => [item.filePath, String(item.churnCount), String(item.avgComplexity), String(item.hotspotScore)]))); break;
        case 'deadcode':
        case 'testgaps': content.replaceChildren(el('p', t('heuristics'), 'hint'), qualityTable(['qualitySymbol', 'file'],
            (data as CodeUnit[]).map(item => [location(item), item.filePath + ':' + item.startLine]))); break;
    }
}

function streamArchitecture(projectId: string, signal: AbortSignal): Promise<ArchitectureReview> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const url = '/api/v1' + qualityPaths.architecture + '?' + new URLSearchParams({ projectId });
        const stream = new EventSource(url);
        let result: ArchitectureReview | undefined;
        function close() { stream.close(); signal.removeEventListener('abort', abort); }
        function abort() { close(); reject(signal.reason); }
        function decode<T>(event: MessageEvent<string>): T | undefined {
            try { return JSON.parse(event.data) as T; }
            catch { close(); reject(new RequestError(502, 'ARCHITECTURE_STREAM_FAILED')); return undefined; }
        }
        stream.addEventListener('phase', () => report('quality-status', 'architectureReady'));
        stream.addEventListener('result', (event: MessageEvent<string>) => { result = decode<ArchitectureReview>(event); });
        stream.addEventListener('complete', () => {
            close();
            if (result?.projectId === projectId) resolve(result);
            else reject(new RequestError(502, 'ARCHITECTURE_STREAM_FAILED'));
        });
        stream.addEventListener('stream-error', (event: MessageEvent<string>) => {
            const error = decode<{ message: string }>(event);
            close();
            reject(new RequestError(502, error?.message ?? 'ARCHITECTURE_STREAM_FAILED'));
        });
        stream.onerror = () => { close(); reject(new RequestError(502, 'ARCHITECTURE_STREAM_FAILED')); };
        signal.addEventListener('abort', abort, { once: true });
    });
}

function renderArchitecture(content: HTMLElement, review: ArchitectureReview) {
    content.replaceChildren(el('p', t(review.status === 'DISABLED' ? 'architectureDisabled'
        : review.status === 'FAILED' ? 'architectureFailed' : 'COMPLETED'), 'hint'));
    for (const observation of review.observations) content.append(el('p', observation));
    if (review.candidates.length) content.append(el('h3', t('architectureSuggestions')));
    for (const candidate of review.candidates) {
        const row = el('section', '', 'architecture-candidate');
        row.append(el('h3', candidate.title), el('p', [candidate.location, candidate.methodology, ...candidate.citations].join(' · '), 'mono hint'));
        for (const [key, value] of [['architectureProblem', candidate.problem], ['architectureSuggestion', candidate.suggestion],
            ['architectureBenefit', candidate.benefit], ['architectureCost', candidate.cost], ['architectureRisk', candidate.risk]]) {
            const field = el('p');
            field.append(el('strong', t(key)), ' · ' + value);
            row.append(field);
        }
        content.append(row);
    }
    if (review.usage) {
        const { inputTokens, outputTokens, costUsd } = review.usage;
        content.append(el('p', [t('architectureUsage'), review.model, `${inputTokens ?? '—'} / ${outputTokens ?? '—'} tokens`,
            costUsd === null ? t('architecturePriceUnknown') : new Intl.NumberFormat(language, {
                style: 'currency', currency: 'USD', maximumFractionDigits: 6
            }).format(costUsd)].join(' · '), 'hint'));
    }
    const rows = review.evidence.map(item => {
        const { filePath, line } = item;
        const link = filePath && line ? resultButton('openSource', () => navigate('graph', review.projectId,
            { file: filePath, line: String(line) })) : '—';
        return [item.citationId, item.location, item.summary, link];
    });
    content.append(el('h3', t('architectureEvidence')), qualityTable(['evidenceReference', 'file', 'evidenceSummary', 'openSource'], rows));
    if (review.missingInfo.length) {
        const omissions = el('ul');
        omissions.append(...review.missingInfo.map(reason => el('li', t(reason))));
        content.append(omissions);
    }
}

function loadChangeReview(id: string | null, runId: string | null = null) {
    controllers.get('change')?.abort();
    controllers.get('change-export')?.abort();
    controllers.get('change-model')?.abort();
    controllers.get('change-cancel')?.abort();
    changeSnapshot = undefined;
    changeRun = undefined;
    element('change-snapshot').hidden = true;
    element('change-run').hidden = true;
    element('change-results').replaceChildren();
    element('change-run-steps').replaceChildren();
    report('change-status');
    report('change-export-status');
    report('change-model-status');
    report('change-cancel-status');
    const projectId = selected;
    if (!projectId || !isUuid(id)) return;
    void run('change', signal => api<ChangeSnapshot>(`/change-reviews/${id}`, { projectId }, { signal }), snapshot => {
        changeSnapshot = snapshot;
        renderChangeReview(snapshot);
        report('change-status');
        if (isUuid(runId)) void trackChangeRun(snapshot, runId);
    });
}

function resetFindings() {
    resetAdvisory('finding');
    findingList = undefined;
    findingDetail = undefined;
    element('finding-list').hidden = true;
    element('finding-list-content').replaceChildren();
    element('finding-detail').hidden = true;
    element('finding-detail-content').replaceChildren();
    element<HTMLFormElement>('findings-form').reset();
    for (const status of ['finding-list-status', 'finding-detail-status', 'finding-feedback-status',
        'finding-import-status', 'queue-submit-status', 'vuln-seed-status']) report(status);
}

function loadFindings(offset: number) {
    const projectId = selected;
    if (!projectId) { report('finding-list-status', 'pickFirst', '', 'warning'); return; }
    void run('finding-list', signal => api<FindingList>('/triage/findings', { projectId, offset: String(offset) }, { signal }), result => {
        findingList = result;
        renderFindingList(result);
        report('finding-list-status', result.total ? '' : 'findingEmpty');
    });
}

function loadFindingDetail(id: string | null) {
    resetAdvisory('finding');
    controllers.get('finding-detail')?.abort();
    controllers.get('finding-feedback')?.abort();
    findingDetail = undefined;
    element('finding-detail').hidden = true;
    element('finding-detail-content').replaceChildren();
    report('finding-detail-status');
    report('finding-feedback-status');
    const projectId = selected;
    if (!projectId || !id || !/^[a-f0-9]{16}$/.test(id)) return;
    void run('finding-detail', signal => api<FindingDetail>('/triage/findings/' + id, { projectId }, { signal }), result => {
        findingDetail = result;
        renderFindingDetail(result);
        report('finding-detail-status');
    });
}

function findingLink(label: string, fingerprint: string, projectId: string) {
    const link = el('a', label) as HTMLAnchorElement;
    link.href = route('findings', projectId, { finding: fingerprint });
    return link;
}

function renderFindingList(page: FindingList) {
    element('finding-list').hidden = !page.total;
    if (!page.total) { element('finding-list-content').replaceChildren(); return; }
    const rows = page.findings.map(finding => [findingLink(`${finding.tool} · ${finding.ruleId}`, finding.fingerprint, page.projectId),
        evidenceLocation(finding.filePath, finding.startLine, finding.startLine), finding.severity]);
    element('finding-list-content').replaceChildren(qualityTable(['findingRule', 'file', 'findingSeverity'], rows));
    element<HTMLButtonElement>('findings-previous').disabled = page.offset === 0;
    element<HTMLButtonElement>('findings-next').disabled = !page.hasMore;
}

function renderFindingDetail(entry: FindingDetail) {
    const { finding, report: assessment } = entry;
    const content = element('finding-detail-content');
    content.replaceChildren(el('h3', `${finding.tool} · ${finding.ruleId}`),
        el('p', [finding.severity, finding.cwe, t(assessment.verdict)].filter(Boolean).join(' · '), 'kind'),
        el('p', finding.message));
    const location = evidenceLocation(finding.filePath, finding.startLine, finding.endLine);
    if (location) content.append(el('p', location, 'mono'));
    if (finding.legacyScan) {
        const { scanner, scanId, lastSeenAt } = finding.legacyScan;
        const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
        const label = [t('legacyScan'), scanner, scanId, date.format(new Date(lastSeenAt))].filter(Boolean).join(' · ');
        if (finding.legacyScan.hasArchivedRun) {
            const archive = el('p', '', 'change-actions');
            archive.append(scanHistoryLink(label, assessment.scope, { scan: scanId }));
            content.append(archive);
        } else content.append(el('p', label, 'hint'));
    }
    const versions = [finding.codeVersion, finding.ruleVersion].filter(Boolean);
    if (versions.length) content.append(el('p', versions.join(' · '), 'mono hint'));
    for (const reason of assessment.missingInfo) content.append(el('p', t(reason), 'hint'));
    renderFindingDecisions(content, assessment);
    for (const item of assessment.pack.evidence) {
        const line = finding.filePath === item.filePath && finding.startLine >= item.startLine && finding.startLine <= item.endLine
            ? finding.startLine : item.startLine;
        content.append(el('h3', item.qualifiedName), el('pre', item.excerpt), resultButton('openSource', () =>
            navigate('graph', item.projectId, { file: item.filePath, line: String(line) })));
    }
    if (finding.trace.length) {
        const hasPaths = finding.trace.some(trace => trace.path !== undefined);
        const columns = hasPaths ? ['findingTracePath', 'file', 'line', 'relation'] : ['file', 'line', 'relation'];
        const rows = finding.trace.map(trace => [
            ...(hasPaths ? [String(trace.path ?? '—')] : []), trace.filePath, `${trace.startLine}–${trace.endLine}`, trace.kind
        ]);
        content.append(el('h3', t('findingTrace')), qualityTable(columns, rows));
    }
    const actions = el('div', '', 'change-actions');
    actions.append(resultButton('queueSubmit', () => submitForReview(entry)), resultButton('vulnAdd', () => registerVulnerability(entry)));
    actions.append(resultButton('triagePrepare', () => navigate('triage-agent', assessment.scope, { finding: finding.fingerprint })));
    content.append(actions);
    if (finding.codeVersion && finding.ruleVersion) content.append(findingFeedbackForm(entry));
    else content.append(el('p', t('findingFeedbackVersions'), 'hint'));
    element('finding-detail').hidden = false;
    renderAdvisory('finding', true);
}

function resetAdvisory(panel: AdvisoryPanel) {
    const key = panel + '-advisory';
    controllers.get(key)?.abort();
    advisoryResults.delete(panel);
    report(key + '-status');
    renderAdvisory(panel, false);
}

function renderAdvisory(panel: AdvisoryPanel, available: boolean) {
    const key = panel + '-advisory';
    element(key + '-panel').hidden = !available;
    const content = element(key + '-content');
    content.replaceChildren();
    const result = advisoryResults.get(panel);
    content.hidden = !result;
    if (!result) return;
    content.append(el('h3', t('advisoryTitle')),
        el('p', [t('advisoryBaseline'), t(result.heuristicReport.verdict)].join(' · '), 'hint'));
    const assessment = result.status === 'COMPLETED'
        ? result.suggestedVerdict ? t(result.suggestedVerdict) : t('advisoryWithoutVerdict')
        : t('advisory' + result.status);
    content.append(el('p', [assessment, result.model].filter(Boolean).join(' · '), 'kind'));
    if (result.citations.length) {
        const citations = result.heuristicReport.pack.evidence.filter(item => result.citations.includes(item.citationId));
        const list = el('ul');
        for (const item of citations) {
            list.append(el('li', [item.citationId, evidenceLocation(item.filePath, item.startLine, item.endLine)].join(' · ')));
        }
        content.append(list);
    }
    for (const reason of result.missingInfo) {
        if (reason !== 'GENERATION_DISABLED') content.append(el('p', t(reason), 'hint'));
    }
}

for (const panel of ['finding', 'queue'] as const) {
    const key = panel + '-advisory';
    const button = element<HTMLButtonElement>(key + '-button');
    button.addEventListener('click', () => {
        const projectId = selected;
        const baseline = panel === 'finding' ? findingDetail?.report : queueDetail?.item.report;
        const snapshotId = panel === 'queue' ? queueDetail?.snapshot.id : undefined;
        if (!projectId || !baseline || baseline.scope !== projectId || controllers.has(key)) return;
        advisoryResults.delete(panel);
        renderAdvisory(panel, true);
        button.disabled = true;
        void run(key, signal => api<TriageAdvisory>('/triage/advisory', { projectId },
            jsonRequest({ fingerprint: baseline.finding.fingerprint, snapshotId }, 'POST', signal)), result => {
            advisoryResults.set(panel, result);
            report(key + '-status');
            renderAdvisory(panel, true);
        }).finally(() => { button.disabled = false; });
    });
}

function renderFindingDecisions(content: HTMLElement, report: FindingDetail['report']) {
    for (const item of report.decisionEvidence) {
        content.append(el('p', [t(item.source), t(item.applied ? 'findingDecisionApplied' : 'findingDecisionSkipped'),
            item.reference, item.summary].filter(Boolean).join(' · '), 'hint'));
    }
}

function findingFeedbackForm(detail: FindingDetail) {
    const form = document.createElement('form');
    form.className = 'stack';
    const status = document.createElement('select');
    for (const value of ['NEEDS_REVIEW', 'TRUE_POSITIVE', 'FALSE_POSITIVE', 'FIXED']) status.add(new Option(t(value), value));
    const reasons = document.createElement('textarea');
    reasons.rows = 2;
    reasons.maxLength = 500;
    const statusLabel = el('label');
    statusLabel.append(el('span', t('findingFeedback')), status);
    const reasonLabel = el('label');
    reasonLabel.append(el('span', t('reason')), reasons);
    const submit = document.createElement('button');
    submit.textContent = t('findingFeedbackSave');
    const fields = el('div', '', 'change-versions');
    fields.append(statusLabel, reasonLabel);
    const actions = el('div', '', 'change-actions');
    actions.append(submit);
    form.append(fields, actions);
    form.addEventListener('submit', event => {
        event.preventDefault();
        const projectId = selected;
        if (!projectId || projectId !== detail.report.scope || controllers.has('finding-feedback')) return;
        const { fingerprint, codeVersion, ruleVersion } = detail.finding;
        submit.disabled = true;
        void run('finding-feedback', async signal => {
            await api('/triage/feedback', { projectId }, jsonRequest({
                fingerprint, codeVersion, ruleVersion, status: status.value, reason: reasons.value
            }, 'POST', signal));
            return api<FindingDetail>('/triage/findings/' + fingerprint, { projectId }, { signal });
        }, result => {
            resetAdvisory('finding');
            findingDetail = result;
            renderFindingDetail(result);
            report('finding-feedback-status', 'findingFeedbackSaved', '', 'success');
        }).finally(() => { submit.disabled = false; });
    });
    return form;
}

function submitForReview(detail: FindingDetail) {
    const projectId = selected;
    if (!projectId || detail.report.scope !== projectId || controllers.has('queue-submit')) return;
    void run('queue-submit', signal => api<ReturnType<ReviewQueue['submit']>>('/review-queue/snapshots', { projectId },
        jsonRequest({ fingerprints: [detail.fingerprint] }, 'POST', signal)), result => {
        report('queue-submit-status');
        navigate('review-queue', projectId, { snapshot: result.snapshotId, entry: result.entries[0].id });
    });
}

function registerVulnerability(detail: FindingDetail) {
    const projectId = selected;
    if (!projectId || detail.report.scope !== projectId || controllers.has('vuln-seed')) return;
    void run('vuln-seed', signal => api<VulnerabilityFinding>('/vulns/from-finding', { projectId },
        jsonRequest({ fingerprint: detail.fingerprint }, 'POST', signal)), finding => {
        report('vuln-seed-status');
        navigate('vulnerabilities', projectId, { vulnerability: finding.id });
    });
}

function vulnerabilityLink(label: string, id: string, projectId: string) {
    const anchor = el('a', label) as HTMLAnchorElement;
    const params = { vulnerability: id };
    anchor.href = route('vulnerabilities', projectId, params);
    anchor.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        navigate('vulnerabilities', projectId, params);
    });
    return anchor;
}

function resetVulnerabilities() {
    vulnPage = undefined;
    vulnDetail = undefined;
    select('vuln-filter').value = '';
    select('vuln-severity').value = '';
    element('vuln-detail').hidden = true;
    element('vuln-detail-content').replaceChildren();
    element('vuln-list-content').replaceChildren();
    for (const id of ['vuln-previous', 'vuln-next']) element<HTMLButtonElement>(id).disabled = true;
    for (const id of ['vuln-list-status', 'vuln-detail-status', 'vuln-transition-status', 'inventory-scan-status']) report(id);
}

function loadVulnerabilities(offset: number) {
    const projectId = selected;
    if (!projectId) { report('vuln-list-status', 'pickFirst', '', 'warning'); return; }
    void run('vuln-list', signal => api<VulnerabilityFinding[]>('/vulns', { projectId, severity: select('vuln-severity').value,
        status: select('vuln-filter').value, limit: String(vulnPageSize + 1), offset: String(offset) }, { signal }), items => {
        vulnPage = { items, offset };
        renderVulnerabilities(vulnPage);
        report('vuln-list-status', items.length ? '' : 'vulnEmpty');
    });
}

function renderVulnerabilities(page: NonNullable<typeof vulnPage>) {
    const rows = page.items.slice(0, vulnPageSize).map(finding => [vulnerabilityLink(finding.title, finding.id, finding.projectId),
        finding.startLine > 0 ? `${finding.filePath}:${finding.startLine}` : finding.filePath, finding.severity, t(finding.status)]);
    element('vuln-list-content').replaceChildren(...(rows.length ? [qualityTable(['findingRule', 'file', 'findingSeverity', 'queueStatus'], rows)] : []));
    element<HTMLButtonElement>('vuln-previous').disabled = page.offset === 0;
    element<HTMLButtonElement>('vuln-next').disabled = page.items.length <= vulnPageSize;
}

function loadVulnerabilityDetail(id: string | null, preserveNotice = false) {
    controllers.get('vuln-detail')?.abort();
    vulnDetail = undefined;
    element('vuln-detail').hidden = true;
    element('vuln-detail-content').replaceChildren();
    report('vuln-detail-status');
    if (!preserveNotice) report('vuln-transition-status');
    const projectId = selected;
    if (!projectId || !id || !/^[a-f0-9]{16}$/.test(id)) return;
    void run('vuln-detail', signal => api<VulnerabilityDetail>('/vulns/' + id, { projectId }, { signal }), result => {
        vulnDetail = result;
        renderVulnerabilityDetail(result);
        report('vuln-detail-status');
    });
}

function renderVulnerabilityDetail({ finding, audit, reviews, evidence }: VulnerabilityDetail) {
    const content = element('vuln-detail-content');
    const projectId = finding.projectId;
    content.replaceChildren(el('h3', finding.title), el('p', [t(finding.status), finding.severity, finding.cwe].filter(Boolean).join(' · '), 'kind'));
    if (finding.legacyImported) content.append(el('p', t('legacyVulnerability'), 'hint'));
    if (finding.detail) content.append(el('p', finding.detail));
    const links = el('div', '', 'change-actions');
    if (finding.dependency) {
        const dependency = finding.dependency;
        content.append(el('p', dependency.purl, 'mono'), el('p', dependency.manifests.join(' · '), 'mono'),
            el('p', [`${t('dependencySource')} · ${dependency.source}`,
                dependency.fixed && `${t('dependencyFixed')} · ${dependency.fixed}`].filter(Boolean).join(' · '), 'hint'));
    } else {
        const location = evidenceLocation(finding.filePath, finding.startLine, finding.endLine);
        if (location) content.append(el('p', location, 'mono'));
        if (finding.filePath && finding.startLine > 0 && (finding.unitId || finding.legacyImported)) links.append(resultButton('openSource', () => navigate('graph', projectId,
            { file: finding.filePath, line: String(finding.startLine) })));
        if (!reviews.length && !finding.legacyImported && !finding.sourceCheck)
            links.append(findingLink(t('findings'), finding.fingerprint, projectId));
    }
    links.append(resultButton('triagePrepare', () => navigate('triage-agent', projectId, { vulnerability: finding.id })));
    content.append(links);
    if (reviews.length) {
        const list = el('ul');
        for (const review of reviews) {
            const item = el('li');
            const link = el('a', `${t('queueFrozen')} · ${review.snapshotId.slice(0, 8)}`) as HTMLAnchorElement;
            link.href = route('review-queue', projectId, { snapshot: review.snapshotId, entry: review.entryId });
            item.append(link);
            list.append(item);
        }
        content.append(el('h3', t('review-queue')), list);
    }
    if (evidence.length) {
        const path = el('ol');
        for (const step of evidence) {
            const item = el('li');
            item.setAttribute('value', String(step.sequence));
            item.append(el('strong', [t('legacyEvidence' + step.role), step.methodQn].filter(Boolean).join(' · ')));
            const location = evidenceLocation(step.filePath, step.startLine, step.endLine);
            if (location) item.append(el('p', location, 'mono'));
            const slots = [step.fromSlot, step.toSlot].filter(Boolean).join(' → ');
            if (slots) item.append(el('p', slots, 'hint'));
            if (step.sourceExcerpt) item.append(el('pre', step.sourceExcerpt));
            path.append(item);
        }
        content.append(el('h3', t(finding.legacyImported ? 'legacyVulnerabilityEvidence' : 'taintScanEvidence')), path);
    }
    if (finding.status === 'SUSPECTED' || finding.status === 'CONFIRMED') {
        const reason = document.createElement('textarea');
        reason.maxLength = 500;
        reason.rows = 2;
        const label = el('label');
        label.append(el('span', t('vulnOptionalReason')), reason);
        const actions = el('div', '', 'change-actions');
        actions.append(finding.status === 'SUSPECTED'
            ? resultButton('vulnConfirm', () => updateVulnerability(finding, 'CONFIRMED', reason.value))
            : resultButton('vulnFix', () => updateVulnerability(finding, 'FIXED', reason.value)),
        resultButton('vulnDismiss', () => updateVulnerability(finding, 'DISMISSED', reason.value)));
        content.append(label, actions);
    }
    const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    const timeline = el('ol');
    for (const event of audit) {
        const item = el('li', [t(event.toStatus), event.actor, date.format(new Date(event.occurredAt))].join(' · '));
        if (event.reason) item.append(el('p', event.reason, 'hint'));
        timeline.append(item);
    }
    content.append(el('h3', t('queueAudit')), timeline);
    element('vuln-detail').hidden = false;
}

function evidenceLocation(path: string, start: number, end: number) {
    if (!path || start <= 0) return path;
    return path + ':' + start + (end > start ? '–' + end : '');
}

function updateVulnerability(finding: VulnerabilityFinding, status: VulnerabilityStatus, reason: string) {
    if (controllers.has('vuln-transition')) return;
    void run('vuln-transition', async signal => {
        try {
            return await api<VulnerabilityFinding>(`/vulns/${finding.id}/status`, { projectId: finding.projectId },
                jsonRequest({ status, revision: finding.revision, reason }, 'PUT', signal));
        } catch (error) {
            if (!signal.aborted && error instanceof RequestError && error.status === 409) {
                loadVulnerabilityDetail(finding.id, true);
                loadVulnerabilities(vulnPage?.offset ?? 0);
            }
            throw error;
        }
    }, result => {
        report('vuln-transition-status');
        loadVulnerabilityDetail(result.id);
        loadVulnerabilities(vulnPage?.offset ?? 0);
    });
}

function resetQueue() {
    resetAdvisory('queue');
    queuePage = undefined;
    queueDetail = undefined;
    queueSelected.clear();
    select('queue-filter').value = '';
    element('queue-detail').hidden = true;
    element('queue-detail-content').replaceChildren();
    element('queue-list-content').replaceChildren();
    for (const id of ['queue-previous', 'queue-next', 'queue-batch']) element<HTMLButtonElement>(id).disabled = true;
    for (const id of ['queue-list-status', 'queue-detail-status', 'queue-transition-status', 'queue-batch-status']) report(id);
}

function loadQueue(page: number) {
    const projectId = selected;
    if (!projectId) { report('queue-list-status', 'pickFirst', '', 'warning'); return; }
    const args = { projectId, page: String(page), size: '25', status: select('queue-filter').value };
    void run('queue-list', signal => api<QueuePage>('/review-queue', args, { signal }), result => {
        queuePage = result;
        renderQueuePage(result);
        report('queue-list-status', result.total ? '' : 'queueEmpty');
    });
}

function renderQueuePage(page: QueuePage) {
    const content = element('queue-list-content');
    const rows = page.entries.map(entry => {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = queueSelected.has(entry.snapshotId);
        checkbox.dataset.snapshotId = entry.snapshotId;
        checkbox.setAttribute('aria-label', t('queueSelect') + ' · ' + entry.ruleId + ' · ' + entry.snapshotId.slice(0, 8));
        checkbox.addEventListener('change', () => {
            if (checkbox.checked && queueSelected.size < 100) queueSelected.add(entry.snapshotId);
            else if (!checkbox.checked) queueSelected.delete(entry.snapshotId);
            for (const item of content.querySelectorAll<HTMLInputElement>('input[data-snapshot-id]')) {
                item.checked = queueSelected.has(item.dataset.snapshotId!);
            }
            element<HTMLButtonElement>('queue-batch').disabled = !queueSelected.size;
        });
        const params = { snapshot: entry.snapshotId, entry: entry.id };
        const detail = el('a', entry.ruleId) as HTMLAnchorElement;
        detail.href = route('review-queue', entry.projectId, params);
        detail.addEventListener('click', event => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            navigate('review-queue', entry.projectId, params);
        });
        return [checkbox, detail, entry.severity, t(entry.status), entry.claimedBy || '—'];
    });
    content.replaceChildren(...(rows.length ? [qualityTable(['queueSelect', 'findingRule', 'findingSeverity', 'queueStatus', 'account'], rows)] : []));
    element<HTMLButtonElement>('queue-previous').disabled = page.page === 0;
    element<HTMLButtonElement>('queue-next').disabled = (page.page + 1) * page.size >= page.total;
    element<HTMLButtonElement>('queue-batch').disabled = !queueSelected.size;
}

function loadQueueDetail(snapshotId: string | null, entryId: string | null, preserveNotice = false) {
    resetAdvisory('queue');
    const projectId = selected;
    queueDetail = undefined;
    element('queue-detail').hidden = true;
    element('queue-detail-content').replaceChildren();
    if (!preserveNotice) report('queue-transition-status');
    report('queue-detail-status');
    controllers.get('queue-detail')?.abort();
    if (!projectId || !isUuid(snapshotId)) return;
    void run('queue-detail', async signal => {
        const bundle = await api<QueueView>(`/review-queue/snapshots/${snapshotId}/review`, { projectId }, { signal });
        const item = entryId ? bundle.items.find(value => value.entry.id === entryId) : bundle.items[0];
        if (!item) throw new RequestError(404, 'REVIEW_ENTRY_NOT_FOUND');
        const audit = await api<QueueAudit>(`/review-queue/${item.entry.id}/audit`, { projectId }, { signal });
        return { snapshot: bundle.snapshot, item, audit };
    }, detail => {
        queueDetail = detail;
        renderQueueDetail(detail);
        report('queue-detail-status');
    });
}

function renderQueueDetail(detail: NonNullable<typeof queueDetail>) {
    const { snapshot, item: { entry, report: frozen, reportMatchCount }, audit } = detail;
    for (const format of ['json', 'markdown', 'pdf']) {
        element<HTMLAnchorElement>('queue-download-' + format).href = `/api/v1/review-queue/snapshots/${snapshot.id}/export?`
            + new URLSearchParams({ projectId: entry.projectId, format });
    }
    const content = element('queue-detail-content');
    content.replaceChildren(el('h3', entry.ruleId), el('p', [t(entry.status), entry.severity, entry.claimedBy].filter(Boolean).join(' · '), 'kind'),
        el('p', [snapshot.codeVersion, snapshot.ruleVersion, snapshot.generatedAt].filter(Boolean).join(' · '), 'mono hint'));
    if (snapshot.legacyImported) content.append(el('p', t('legacyReport'), 'hint'));
    if (entry.vulnerabilityId) content.append(vulnerabilityLink(t('vulnOpen'), entry.vulnerabilityId, entry.projectId));
    if (frozen) {
        const finding = frozen.finding;
        const location = evidenceLocation(finding.filePath, finding.startLine, finding.endLine);
        content.append(el('p', finding.message));
        if (location) content.append(el('p', location, 'mono'));
        if (snapshot.legacyImported || frozen.decisionEvidence.length) {
            content.append(el('p', [t(frozen.verdict), new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 })
                .format(frozen.confidence)].join(' · '), 'kind'));
            for (const line of [frozen.developerSummary, ...frozen.reasons, ...frozen.missingInfo, frozen.remediation].filter(Boolean)) {
                content.append(el('p', line));
            }
            renderFindingDecisions(content, frozen);
        }
        for (const citation of frozen.pack.evidence) content.append(el('h4', `${citation.citationId} · ${citation.qualifiedName}`), el('pre', citation.excerpt));
    } else {
        content.append(el('p', `${t('queueReportMatches')} · ${reportMatchCount}`, 'hint'));
    }
    if (frozen && entry.status === 'PENDING') content.append(resultButton('queueClaim', () => updateQueueEntry(entry, 'claim')));
    if (frozen && entry.status === 'IN_REVIEW') {
        const reason = document.createElement('textarea');
        reason.maxLength = 500;
        reason.required = true;
        reason.rows = 2;
        const label = el('label');
        label.append(el('span', t('reason')), reason);
        const actions = el('div', '', 'change-actions');
        for (const [action, label] of [['return', 'queueReturn'], ['confirm', 'queueConfirm'], ['reject', 'queueReject']] as const) {
            actions.append(resultButton(label, () => {
                if (reason.reportValidity()) updateQueueEntry(entry, action, reason.value);
            }));
        }
        content.append(label, actions);
    }
    const timeline = el('ol');
    const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    for (const event of audit) {
        const item = el('li', [t(event.action), event.actor, date.format(new Date(event.occurredAt))].join(' · '));
        if (event.reason) item.append(el('p', event.reason, 'hint'));
        timeline.append(item);
    }
    content.append(el('h3', t('queueAudit')), timeline);
    element('queue-detail').hidden = false;
    renderAdvisory('queue', !!frozen);
}

function updateQueueEntry(entry: ReviewQueueEntry, action: ReviewAction, reason?: string) {
    if (controllers.has('queue-transition')) return;
    void run('queue-transition', async signal => {
        try {
            return await api<ReviewQueueEntry>(`/review-queue/${entry.id}/${action}`, { projectId: entry.projectId },
                jsonRequest({ reason, revision: entry.revision }, 'POST', signal));
        } catch (error) {
            if (!signal.aborted && error instanceof RequestError && error.status === 409) {
                loadQueueDetail(entry.snapshotId, entry.id, true);
                loadQueue(queuePage?.page ?? 0);
            }
            throw error;
        }
    }, updated => {
        report('queue-transition-status');
        loadQueueDetail(updated.snapshotId, updated.id);
        loadQueue(queuePage?.page ?? 0);
    });
}

function resetWiki() {
    wikiSummary = undefined;
    wikiRun = undefined;
    element('wiki-document').hidden = true;
    element('wiki-run').hidden = true;
    element<HTMLButtonElement>('wiki-generate').disabled = false;
    element('wiki-content').replaceChildren();
    element('wiki-document-title').textContent = '';
    element('wiki-export').removeAttribute('href');
    element('wiki-steps').replaceChildren();
    select('wiki-select').replaceChildren();
    report('wiki-generation-status');
}

function loadWiki(documentId: string | null) {
    const projectId = selected;
    if (!projectId) { report('wiki-status', 'pickFirst', '', 'warning'); return; }
    void run('wiki', async signal => {
        const tree = await api<WikiNode[]>('/summaries/tree', { projectId }, { signal });
        const id = isUuid(documentId) ? documentId : tree[0]?.id;
        const document = id ? await api<SummaryDocument>(`/summaries/${id}`, { projectId }, { signal }) : undefined;
        return { tree, document };
    }, ({ tree, document }) => {
        if (!document) {
            wikiSummary = undefined;
            element('wiki-document').hidden = true;
            report('wiki-status', 'wikiEmpty');
            return;
        }
        wikiSummary = { tree, document };
        renderWiki(tree, document);
        report('wiki-status');
    });
}

const wikiFence = /^ {0,3}(`{3,}|~{3,})/;
const wikiHeading = /^ {0,3}(#{1,6})\s+(.+)$/;
const wikiItem = /^ {0,3}([-+*]|\d+[.)])\s+(.+)$/;

function wikiInline(tag: string, value: string) {
    const node = el(tag);
    const plain = (text: string) => text.replace(/\\([\\`*_{}\[\]()#+!|~])/g, '$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    for (const [index, part] of value.split(/(?<!\\)`([^`\n]+)`/).entries()) {
        node.append(index % 2 ? el('code', plain(part)) : plain(part));
    }
    return node;
}

function renderWikiMarkdown(parent: HTMLElement, body: string) {
    const lines = body.split(/\r?\n/);
    const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(value => value.trim());
    const isTable = (row: number) => {
        const divider = lines[row + 1];
        if (!lines[row].includes('|') || !divider?.includes('|')) return false;
        const markers = cells(divider);
        return markers.length === cells(lines[row]).length && markers.every(value => /^:?-{3,}:?$/.test(value));
    };
    let row = 0;
    while (row < lines.length) {
        const line = lines[row];
        if (!line.trim()) { row++; continue; }
        const fence = wikiFence.exec(line)?.[1];
        if (fence) {
            const code: string[] = [];
            const closing = new RegExp('^ {0,3}' + fence[0] + '{' + fence.length + ',}\\s*$');
            while (++row < lines.length && !closing.test(lines[row])) code.push(lines[row]);
            const pre = el('pre');
            pre.append(el('code', code.join('\n')));
            parent.append(pre);
            row++;
            continue;
        }
        const heading = wikiHeading.exec(line);
        if (heading) {
            const level = Math.min(6, Math.max(4, heading[1].length + 1));
            parent.append(wikiInline('h' + level, heading[2]));
            row++;
            continue;
        }
        const item = wikiItem.exec(line);
        if (item) {
            const ordered = /^\d/.test(item[1]);
            const list = el(ordered ? 'ol' : 'ul');
            if (ordered) list.setAttribute('start', item[1].slice(0, -1));
            while (row < lines.length) {
                const next = wikiItem.exec(lines[row]);
                if (!next || /^\d/.test(next[1]) !== ordered) break;
                list.append(wikiInline('li', next[2]));
                row++;
            }
            parent.append(list);
            continue;
        }
        if (isTable(row)) {
            const headers = cells(line);
            const table = el('table', '', 'quality-table');
            const head = el('thead'), header = el('tr'), content = el('tbody');
            header.append(...headers.map(value => wikiInline('th', value)));
            head.append(header);
            row += 2;
            while (row < lines.length && lines[row].includes('|')) {
                const columns = cells(lines[row]);
                if (columns.length !== headers.length) break;
                const data = el('tr');
                data.append(...columns.map(value => wikiInline('td', value)));
                content.append(data);
                row++;
            }
            table.append(head, content);
            const scroll = el('div', '', 'wiki-table');
            scroll.append(table);
            parent.append(scroll);
            continue;
        }
        const paragraph = [line];
        while (++row < lines.length && lines[row].trim() && !wikiFence.test(lines[row]) && !wikiHeading.test(lines[row])
            && !wikiItem.test(lines[row]) && !isTable(row)) paragraph.push(lines[row]);
        const text = wikiInline('p', paragraph.join('\n'));
        text.className = 'wiki-summary-text';
        parent.append(text);
    }
}

function renderWiki(tree: WikiNode[], doc: SummaryDocument) {
    const selector = select('wiki-select');
    const options = tree.map(item => new Option(item.name + ' · v' + item.docVersion, item.id));
    if (!tree.some(item => item.id === doc.id)) options.push(new Option(doc.title + ' · v' + doc.docVersion, doc.id));
    selector.replaceChildren(...options);
    selector.value = doc.id;
    element('wiki-document-title').textContent = doc.title;
    element<HTMLAnchorElement>('wiki-export').href = '/api/v1/summaries/' + doc.id + '/export?' + new URLSearchParams({ projectId: doc.projectId });
    const content = element('wiki-content');
    const format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    content.replaceChildren(el('p', ['v' + doc.docVersion, format.format(new Date(doc.generatedAt)), t(doc.status), doc.model]
        .filter(Boolean).join(' · '), 'hint mono'));
    if (doc.legacyImported) content.append(el('p', t('legacyWiki'), 'hint'));
    for (const section of doc.sections) {
        const subsection = el('section');
        const title = section.source === 'llm' && section.phase ? t('wikiPhase:' + section.phase) : section.title;
        const heading = el('h3', title);
        if (section.source === 'llm') heading.append(' ', el('span', t('wikiModelSection'), 'kind'));
        subsection.append(heading);
        renderWikiMarkdown(subsection, section.body);
        content.append(subsection);
    }
    if (doc.citations.length) {
        const references = el('section');
        const list = el('ul');
        for (const citation of doc.citations) {
            const args = { file: citation.filePath, line: String(citation.startLine) };
            const link = el('a', `${citation.qualifiedName} · ${citation.filePath}:${citation.startLine}`, 'mono') as HTMLAnchorElement;
            link.href = route('graph', doc.projectId, args);
            link.addEventListener('click', event => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                event.preventDefault();
                navigate('graph', doc.projectId, args);
            });
            const item = el('li');
            item.append(link);
            list.append(item);
        }
        references.append(el('h3', t('wikiCitations')), el('p', t('wikiCurrentIndex'), 'hint'), list);
        content.append(references);
    }
    if (doc.missingInfo.length) {
        const notes = el('details');
        const list = el('ul');
        for (const reason of doc.missingInfo) {
            const [code, phase] = doc.legacyImported ? [reason] : reason.split(':', 2);
            list.append(el('li', phase ? t('wikiPhase:' + phase) + ' · ' + t(code) : t(code)));
        }
        notes.append(el('summary', t('wikiNotes')), list);
        content.append(notes);
    }
    element('wiki-document').hidden = false;
}

function renderWikiRun(run: AgentRun) {
    wikiRun = run;
    element('wiki-run').hidden = false;
    const steps = el('ol');
    const names: Record<string, string> = { FACTS: 'wikiFactCollection', LLM_ARCH: 'wikiModelGeneration', PERSIST: 'wikiPersist' };
    for (const step of run.steps) {
        const capability = step.capability.startsWith('LLM_ARCH:') ? 'wikiPhase:' + step.capability.slice('LLM_ARCH:'.length)
            : names[step.capability] ?? step.capability;
        const status = step.status === 'FAILED' ? 'wikiStepFailed' : step.status;
        steps.append(el('li', [t(capability), t(status), step.error ? t(step.error) : step.summary].filter(Boolean).join(' · ')));
    }
    element('wiki-steps').replaceChildren(el('p', t(run.status === 'FAILED' ? 'wikiFailedRun' : run.status), 'kind'), steps);
}

async function trackWiki(id?: string) {
    const projectId = selected;
    const trigger = element<HTMLButtonElement>('wiki-generate');
    const pending = controllers.get('wiki-generation');
    if (!projectId) { report('wiki-generation-status', 'pickFirst', '', 'warning'); return; }
    if (pending && !pending.signal.aborted) return;
    trigger.disabled = true;
    await run('wiki-generation', async signal => {
        let runId = id;
        if (!runId) {
            const started = await api<{ agentRunId: string }>('/summaries/generate', { projectId }, { method: 'POST', signal });
            runId = started.agentRunId;
            if (!signal.aborted) history.replaceState(null, '', route('wiki', projectId, { run: runId }));
        }
        for (let attempt = 0; attempt < 300 && !signal.aborted; attempt++) {
            const result = await api<AgentRun>(`/agent-runs/${runId}`, { projectId }, { signal });
            if (signal.aborted) return null;
            if (result.playbook !== 'WIKI_SUMMARY') throw new RequestError(404, 'NOT_FOUND');
            renderWikiRun(result);
            if (result.status !== 'RUNNING' && result.status !== 'QUEUED') return result;
            await new Promise(resolve => setTimeout(resolve, 750));
        }
        return null;
    }, result => {
        if (!result) { report('wiki-generation-status', 'wikiPending', '', 'warning'); return; }
        if (result.status === 'FAILED') {
            report('wiki-generation-status', 'wikiFailedRun', t(result.statusReason ?? ''), 'error');
            return;
        }
        report('wiki-generation-status', result.status === 'PARTIAL' ? 'wikiPartial' : 'wikiGenerated', '',
            result.status === 'PARTIAL' ? 'warning' : 'success');
        loadWiki(new URL(location.href).searchParams.get('document'));
    });
    if (selected === projectId && !controllers.has('wiki-generation')) trigger.disabled = false;
}

function renderChangeReview(snapshot: ChangeSnapshot) {
    element('change-snapshot').hidden = false;
    element<HTMLAnchorElement>('change-link').href = route('change-review', snapshot.projectId, { snapshot: snapshot.id });
    const symbols = qualityTable(['changeBase', 'changeTarget', 'changePlanned', 'changeOmitted'], [[snapshot.baseVersion,
        snapshot.targetVersion, String(snapshot.plannedHunkCount), String(snapshot.omittedHunkCount)]]);
    const results = element('change-results');
    results.replaceChildren(el('p', t(snapshot.status), 'kind'), symbols);
    if (snapshot.legacyImported) results.append(el('p', t('legacyChangeReview'), 'hint'));
    if (snapshot.omittedReasons.length) {
        const notes = el('ul', '', 'hint');
        for (const reason of snapshot.omittedReasons) notes.append(el('li', t(reason)));
        results.append(notes);
    }
    if (snapshot.hunkLedger.length) {
        const rows = snapshot.hunkLedger.slice(0, 100).map(hunk => {
            const path = hunk.oldPath === hunk.newPath ? hunk.newPath : (hunk.oldPath || '∅') + ' → ' + (hunk.newPath || '∅');
            return [path + ' · ' + hunk.hunkOrdinal, t(hunk.disposition), hunk.reason ? t(hunk.reason) : '—'];
        });
        results.append(el('h3', t('changeLedger')), qualityTable(['file', 'changeMapping', 'changeReason'], rows));
    }
    if (snapshot.units.length) results.append(el('h3', t('changeExcerpt')));
    for (const item of snapshot.units.slice(0, 25)) {
        const evidence = el('details', '', 'change-evidence');
        evidence.dataset.unitId = item.unit.id;
        evidence.append(el('summary', item.unit.filePath + ' · ' + t(item.status)));
        for (const mapping of item.hunkMappings) {
            const span = mapping.changedRanges.map(range => range.startLine + '–' + range.endLine).join(', ');
            evidence.append(el('p', [String(mapping.hunkIndex + 1), span, t(mapping.status), ...mapping.omittedReasons.map(t)].filter(Boolean).join(' · '), 'hint'));
        }
        for (const citation of item.contextPack.evidence) {
            const heading = el('h3', citation.citationId + ' · ' + citation.qualifiedName);
            heading.dataset.citationId = citation.citationId;
            heading.tabIndex = -1;
            evidence.append(heading,
                el('p', citation.filePath + ':' + citation.startLine + '–' + citation.endLine, 'mono hint'), el('pre', citation.excerpt));
        }
        if (item.externalFindingReferences.length) {
            const list = el('ul');
            for (const finding of item.externalFindingReferences) {
                const row = el('li');
                row.append(findingLink(finding.tool + ' · ' + finding.ruleId, finding.fingerprint, snapshot.projectId),
                    ' · ' + t(finding.version));
                list.append(row);
            }
            evidence.append(el('h3', t('findings')), list);
        }
        if (item.vulnerabilityReferences.length) {
            const list = el('ul');
            for (const finding of item.vulnerabilityReferences) {
                const row = el('li');
                row.append(vulnerabilityLink(finding.ruleId, finding.id, snapshot.projectId), ' · ' + t(finding.status) + ' · ' + t(finding.version));
                list.append(row);
            }
            evidence.append(el('h3', t('vulnerabilities')), list);
        }
        for (const [label, references] of [['legacyChangeFindings', item.legacyReferences?.externalFindingFingerprints],
            ['legacyChangeVulnerabilities', item.legacyReferences?.vulnerabilityIds]] as const) {
            if (!references?.length) continue;
            const list = el('ul');
            for (const id of references) list.append(el('li', id, 'mono'));
            evidence.append(el('h3', t(label)), list);
        }
        results.append(evidence);
    }
    if (snapshot.hunkLedger.length > 100 || snapshot.units.length > 25) results.append(el('p', t('changePreviewLimit'), 'hint'));
    element<HTMLButtonElement>('change-model-start').disabled = !snapshot.units.length || activeAgent(changeRun);
}

function activeAgent(run?: AgentRun) { return run?.status === 'QUEUED' || run?.status === 'RUNNING'; }

function triageRunStatus(status: AgentRun['status'] | AgentStep['status']) {
    return t(status === 'FAILED' ? 'triageStepFailed' : status === 'PENDING' ? 'triageStepPending' : status);
}

function resetTriage() {
    triageRuns = [];
    focusTriageRun = '';
    element<HTMLFormElement>('triage-form').reset();
    element<HTMLDetailsElement>('triage-setup').open = true;
    element<HTMLDetailsElement>('triage-advanced').open = false;
    select('triage-target').replaceChildren();
    clearTriageRun();
    renderTriageList();
    renderTriageControls();
    for (const id of ['triage-targets', 'triage-submit', 'triage-runs', 'triage-run', 'triage-cancel']) report(id + '-status');
}

function renderTriageControls() {
    const mode = select('triage-mode');
    const target = select('triage-target');
    const upload = mode.value === 'upload';
    const file = input('triage-file');
    element('triage-upload-fields').hidden = !upload;
    element('triage-target-fields').hidden = upload;
    file.disabled = !upload;
    target.disabled = upload;
    element('triage-code-field').hidden = element('triage-rule-field').hidden = mode.value === 'finding';
    const subject = upload ? file.files?.[0]?.name : target.selectedOptions[0]?.textContent;
    const title = [projects.find(item => item.projectId === selected)?.projectName, mode.selectedOptions[0]?.textContent, subject]
        .filter(Boolean).join(' · ');
    element('triage-setup-selection').textContent = title ? ' · ' + title : '';
    const active = triageRuns.some(activeAgent) || activeAgent(triageRun);
    element<HTMLButtonElement>('triage-start').disabled = !selected || active || controllers.has('triage-submit') || (upload ? !subject : !target.value);
}

function loadTriageTargets(preferred = '') {
    controllers.get('triage-targets')?.abort();
    const picker = select('triage-target');
    picker.replaceChildren();
    report('triage-targets-status');
    renderTriageControls();
    const projectId = selected;
    const mode = select('triage-mode').value;
    if (!projectId || mode === 'upload') return;
    void run('triage-targets', async signal => {
        const args = { projectId, limit: '100' };
        if (mode === 'finding') {
            const page = await api<FindingList>('/triage/findings', args, { signal });
            const items: [string, string][] = page.findings.map(item => [item.fingerprint, item.ruleId + ' · ' + evidenceLocation(item.filePath, item.startLine, item.endLine)]);
            if (preferred && !items.some(([id]) => id === preferred)) {
                const { finding } = await api<FindingDetail>('/triage/findings/' + preferred, { projectId }, { signal });
                items.unshift([preferred, finding.ruleId + ' · ' + evidenceLocation(finding.filePath, finding.startLine, finding.endLine)]);
            }
            return items;
        }
        const inventory = await api<VulnerabilityFinding[]>('/vulns', args, { signal });
        const items: [string, string][] = inventory.map(item => [item.id, item.title]);
        if (preferred && !items.some(([id]) => id === preferred)) {
            const detail = await api<VulnerabilityDetail>('/vulns/' + preferred, { projectId }, { signal });
            items.unshift([preferred, detail.finding.title]);
        }
        return items;
    }, items => {
        options('triage-target', items, 'triageTarget');
        picker.value = preferred;
        report('triage-targets-status', items.length ? '' : 'triageNoTargets');
        renderTriageControls();
    });
}

function clearTriageRun() {
    controllers.get('triage-run')?.abort();
    triageRun = undefined;
    triageSteps.clear();
    element('triage-run').hidden = true;
    element('triage-steps').replaceChildren();
    report('triage-run-status');
    report('triage-cancel-status');
}

function selectTriageRun(id: string, projectId: string) {
    focusTriageRun = id;
    navigate('triage-agent', projectId, { run: id });
}

function renderTriageList() {
    const list = element('triage-run-list');
    const existing = new Map([...list.children].map(node => [node.getAttribute('data-run'), node as HTMLLIElement]));
    for (const [position, item] of triageRuns.entries()) {
        const row = existing.get(item.id) ?? document.createElement('li');
        if (!row.dataset.run) {
            row.dataset.run = item.id;
            row.append(resultButton('', () => selectTriageRun(item.id, item.projectId)));
        }
        existing.delete(item.id);
        const button = row.firstElementChild as HTMLButtonElement;
        const date = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt));
        button.textContent = [date, triageRunStatus(item.status), item.inputReference].join(' · ');
        if (triageRun?.id === item.id) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
        if (list.children[position] !== row) list.insertBefore(row, list.children[position] ?? null);
    }
    for (const row of existing.values()) row.remove();
}

function renderTriageRun(run: AgentRun) {
    const container = element('triage-steps');
    const runRef = element('triage-run-reference');
    runRef.textContent = [run.id, run.inputReference].join(' · ');
    const history = element('triage-run-history-note');
    history.textContent = [run.legacyImported ? t('triageLegacyRun') : '', run.outputUnavailable ? t('triageLegacyOutputUnavailable') : '',
        run.legacyImported && run.statusReason ? t(run.statusReason) : ''].filter(Boolean).join(' · ');
    history.hidden = !history.textContent;
    element('triage-run-state').textContent = triageRunStatus(run.status);
    const download = element<HTMLAnchorElement>('triage-export');
    download.href = '/api/v1/agent-runs/' + run.id + '/export?' + new URLSearchParams({ projectId: run.projectId });
    element('triage-cancel').hidden = !activeAgent(run);
    const snapshot = run.outputReference?.match(/^report-snapshot:(.+)$/)?.[1] ?? null;
    const openReview = element<HTMLAnchorElement>('triage-open-review');
    if (!run.outputUnavailable && isUuid(snapshot)) openReview.href = route('review-queue', run.projectId, { snapshot });
    else openReview.removeAttribute('href');
    openReview.hidden = !openReview.hasAttribute('href');
    for (const step of run.steps) {
        let row = triageSteps.get(step.id);
        if (!row) {
            const node = document.createElement('details');
            node.className = 'triage-step';
            node.open = step.status === 'FAILED' || step.status === 'PARTIAL';
            node.append(el('summary'), el('div', '', 'triage-step-content'));
            container.append(node);
            row = { node, state: '' };
            triageSteps.set(step.id, row);
        }
        const state = language + JSON.stringify(step);
        if (state === row.state) continue;
        row.state = state;
        row.node.children[0].textContent = [t(step.capability), triageRunStatus(step.status)].join(' · ');
        const details = row.node.children[1];
        const sections: HTMLElement[] = [];
        if (step.summary) sections.push(el('p', step.summary));
        if (step.evidenceReferences.length) {
            const references = el('ul');
            for (const ref of step.evidenceReferences) references.append(el('li', ref, 'mono'));
            sections.push(references);
        }
        for (const result of step.results) {
            const message = [result.subjectReference, t('advisoryBaseline') + ' · ' + t(result.baseline),
                result.recommendation ? t(result.recommendation) : t('advisoryWithoutVerdict')].join(' · ');
            sections.push(el('p', t('advisoryTitle'), 'kind'), el('p', message));
        }
        for (const note of new Set([...step.missingInfo, ...(step.error ? [step.error] : [])])) sections.push(el('p', t(note), 'hint'));
        details.replaceChildren(...sections);
    }
    element('triage-run').hidden = false;
}

function showTriageRun(current: AgentRun) {
    if (triageRun?.id !== current.id) {
        triageSteps.clear();
        element('triage-steps').replaceChildren();
    }
    triageRun = current;
    const index = triageRuns.findIndex(item => item.id === current.id);
    if (index < 0) triageRuns.unshift(current);
    else triageRuns[index] = current;
    renderTriageRun(current);
    renderTriageList();
    renderTriageControls();
    if (focusTriageRun === current.id) {
        focusTriageRun = '';
        element('triage-run-title').focus();
    }
}

function loadTriageRun(projectId: string, id: string) {
    if (triageRun?.id !== id) clearTriageRun();
    void run('triage-run', async signal => {
        for (let attempt = 0; attempt < 300 && !signal.aborted; attempt++) {
            let current: AgentRun;
            try {
                current = await api<AgentRun>('/agent-runs/' + id, { projectId }, { signal });
            } catch (error) {
                if (signal.aborted) return;
                if (error instanceof RequestError && [401, 403, 404].includes(error.status)) {
                    triageRun = undefined;
                    triageSteps.clear();
                    element('triage-steps').replaceChildren();
                    element('triage-run').hidden = true;
                    throw error;
                }
                if (!triageRun) throw error;
                return 'triageStateUnknown';
            }
            if (signal.aborted) return;
            if (current.playbook !== 'SAST_TRIAGE') throw new RequestError(404, 'NOT_FOUND');
            if (triageRun?.id !== current.id || triageRun.updatedAt !== current.updatedAt || triageRun.status !== current.status) showTriageRun(current);
            report('triage-run-status');
            if (!activeAgent(current)) return;
            await new Promise(resolve => setTimeout(resolve, 750));
        }
        return signal.aborted ? undefined : 'triageStateUnknown';
    }, message => report('triage-run-status', message ?? '', '', message ? 'warning' : undefined));
}

function loadTriageWorkspace(params: URLSearchParams) {
    const projectId = selected;
    const origin = params.get('vulnerability') ?? params.get('finding');
    const runId = params.get('run');
    if (origin && /^[a-f0-9]{16}$/.test(origin)) {
        select('triage-mode').value = params.has('vulnerability') ? 'vulnerability' : 'finding';
        element<HTMLDetailsElement>('triage-setup').open = true;
    }
    const preferred = origin && /^[a-f0-9]{16}$/.test(origin) ? origin : select('triage-target').value;
    loadTriageTargets(preferred);
    if (!projectId) { report('triage-runs-status', 'pickFirst', '', 'warning'); return; }
    void run('triage-runs', signal => api<AgentRun[]>('/agent-runs', { projectId, limit: '20', playbook: 'SAST_TRIAGE' }, { signal }), items => {
        triageRuns = items.map(item => triageRun?.id === item.id && triageRun.updatedAt >= item.updatedAt ? triageRun : item);
        renderTriageList();
        renderTriageControls();
        report('triage-runs-status', items.length ? '' : 'triageEmpty');
    });
    if (isUuid(runId)) loadTriageRun(projectId, runId);
    else clearTriageRun();
}

function changeCitationButton(unitId: string, citation: string) {
    const button = el('button', citation, 'change-citation') as HTMLButtonElement;
    button.type = 'button';
    button.addEventListener('click', () => {
        const details = Array.from(element('change-results').querySelectorAll<HTMLDetailsElement>('details[data-unit-id]'))
            .find(item => item.dataset.unitId === unitId);
        if (!details) return;
        details.open = true;
        const heading = Array.from(details.querySelectorAll<HTMLElement>('[data-citation-id]'))
            .find(item => item.dataset.citationId === citation);
        heading?.focus();
    });
    return button;
}

function renderChangeRun(run: AgentRun) {
    changeRun = run;
    element('change-run').hidden = false;
    element('change-model-state').textContent = t(run.status);
    element('change-model-cancel').hidden = !activeAgent(run);
    element<HTMLButtonElement>('change-model-start').disabled = activeAgent(run);
    const steps = el('ol');
    for (const step of run.steps) {
        const id = step.evidenceReferences.find(reference => reference.startsWith('change-unit:'))?.split(':').at(-1);
        const unit = changeSnapshot?.units.find(item => item.unit.id === id);
        const status = step.error === 'CANCELLED' ? 'CANCELLED' : step.status;
        const title = [t(step.capability), unit?.unit.filePath, t(status)].filter(Boolean).join(' · ');
        const row = el('li');
        row.append(el('strong', title));
        for (const reason of new Set(step.missingInfo)) {
            if (step.capability !== 'BUILD_CHANGE_REVIEW') row.append(el('p', t(reason), 'hint'));
        }
        if (run.legacyImported && changeSnapshot) {
            const prefix = 'change-evidence:' + changeSnapshot.id + ':';
            const actions = el('div', '', 'change-actions');
            for (const reference of new Set(step.evidenceReferences)) {
                if (!reference.startsWith(prefix)) continue;
                const scoped = reference.slice(prefix.length);
                const separator = scoped.indexOf(':');
                if (separator < 1) continue;
                const subject = scoped.slice(0, separator), citation = scoped.slice(separator + 1);
                const registered = changeSnapshot.units.find(item => item.unit.id === subject)?.contextPack.evidence;
                if (registered?.some(item => item.citationId === citation)) actions.append(changeCitationButton(subject, citation));
            }
            if (actions.childElementCount) row.append(actions);
        }
        for (const result of step.results) {
            const advice = el('p');
            advice.append(el('span', t('changeAdvisoryOnly'), 'kind'), ' ' + result.recommendation);
            row.append(advice);
            const actions = el('div', '', 'change-actions');
            if (id) for (const citation of result.citationIds) actions.append(changeCitationButton(id, citation));
            if (actions.childElementCount) row.append(actions);
        }
        steps.append(row);
    }
    element('change-run-steps').replaceChildren(steps);
}

async function trackChangeRun(snapshot: ChangeSnapshot, runId?: string) {
    const start = element<HTMLButtonElement>('change-model-start');
    const { projectId } = snapshot;
    start.disabled = true;
    await run('change-model', async signal => {
        let id = runId;
        if (!id) {
            const accepted = await api<AgentRun>('/agent-runs/change-review', {}, jsonRequest({ projectId, snapshotId: snapshot.id }, 'POST', signal));
            if (signal.aborted) return;
            id = accepted.id;
            renderChangeRun(accepted);
            history.replaceState(null, '', route('change-review', projectId, { snapshot: snapshot.id, run: id }));
        }
        for (let attempt = 0; attempt < 300 && !signal.aborted; attempt++) {
            const current = await api<AgentRun>(`/agent-runs/${id}`, { projectId }, { signal });
            if (signal.aborted) return;
            if (current.playbook !== 'CHANGE_REVIEW' || current.outputReference !== `change-review:${snapshot.id}`) {
                throw new RequestError(404, 'NOT_FOUND');
            }
            if (changeRun?.id !== current.id || changeRun.updatedAt !== current.updatedAt || changeRun.status !== current.status) renderChangeRun(current);
            if (!activeAgent(current)) return;
            await new Promise(resolve => setTimeout(resolve, 750));
        }
    }, () => report('change-model-status'));
    if (changeSnapshot?.id === snapshot.id && !controllers.has('change-model')) start.disabled = activeAgent(changeRun);
}

function resetSbom() {
    sbom = undefined;
    dependencyScan = undefined;
    element('sbom-section').hidden = true;
    element('sbom-download').hidden = true;
    element('sbom-content').replaceChildren();
    element('dependency-scan-content').replaceChildren();
    report('sbom-status');
    report('dependency-scan-status');
}

function renderDependencyScan(result: DependencyScanResult) {
    const content = element('dependency-scan-content');
    content.replaceChildren(el('p',
        [`${t('dependencyScanned')} ${result.scannedComponents}`, `${t('dependencyMatches')} ${result.matchedFindings}`,
            `${t('dependencyNew')} ${result.newFindings}`].join(' · '), 'hint'));
    if (result.preview.length) content.append(qualityTable(['dependencyAdvisory', 'dependencyCoordinate', 'findingSeverity'],
        result.preview.map(item => [vulnerabilityLink(item.advisoryId, item.id, result.projectId),
            item.coordinate + '@' + item.version, item.severity])));
    if (result.matchedFindings > result.preview.length) content.append(el('p', t('dependencyMore'), 'hint'));
    if (result.issues.length) {
        const list = el('ul');
        list.append(...result.issues.map(issue => el('li', issue)));
        content.append(list);
    }
    report('dependency-scan-status', result.unverifiedComponents ? 'dependencyUnverified' : '',
        String(result.unverifiedComponents), 'warning');
}

function renderSbom(result: Sbom) {
    const content = element('sbom-content');
    const list = el('ul', '', 'mono');
    for (const component of result.components.slice(0, 50)) list.append(el('li', component.purl));
    content.replaceChildren(el('p', `${t('sbomComponents')} · ${result.components.length} · CycloneDX ${result.specVersion}`, 'hint'));
    if (list.childElementCount) content.append(list);
    if (result.components.length > 50) content.append(el('p', t('sbomPreviewLimit'), 'hint'));
    for (const property of result.metadata.properties ?? []) {
        if (property.name === 'repograph:inventoryIssue') content.append(el('p', property.value, 'hint'));
    }
    element('sbom-download').hidden = false;
    report('sbom-status');
}

function showLogin(key = '') {
    connected = false;
    indexRequest?.abort();
    indexRequest = undefined;
    archiveRequest?.abort();
    archiveRequest = undefined;
    element<HTMLFormElement>('archive-form').reset();
    element('archive-status').hidden = true;
    element('profile-content').replaceChildren();
    archiveOverview = undefined;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    if (element<HTMLDialogElement>('source-dialog').open) element<HTMLDialogElement>('source-dialog').close();
    projects = [];
    account = undefined;
    administration = undefined;
    providers = [];
    element<HTMLFormElement>('provider-form').reset();
    element('provider-form').hidden = true;
    element('provider-models').replaceChildren();
    organizationMembers = [];
    for (const id of ['account-list', 'audit-list', 'members-list']) element(id).replaceChildren();
    for (const id of ['review-account', 'managed-org', 'member-account', 'owner-project', 'owner-target']) {
        select(id).replaceChildren();
    }
    if (element<HTMLDialogElement>('account-dialog').open) element<HTMLDialogElement>('account-dialog').close();
    overview = undefined;
    resetWiki();
    resetFindings();
    resetScanHistory();
    benchmarkView = undefined;
    benchmarkOpen.clear();
    benchmarkMisses.clear();
    element('benchmark-content').replaceChildren();
    element('benchmark-content').setAttribute('aria-busy', 'false');
    resetQueue();
    resetVulnerabilities();
    resetTriage();
    loadChangeReview(null);
    element<HTMLFormElement>('change-form').reset();
    resetQuality();
    watchState = undefined;
    watchBusy = false;
    renderWatch();
    resetSbom();
    element('overview-data').replaceChildren();
    element('overview-root').textContent = '';
    for (const panel of ['search', 'graph', 'evidence']) element(`${panel}-results`).replaceChildren();
    flowView = undefined;
    for (const id of [...notes.keys()]) report(id);
    nextPage = undefined;
    element('next').hidden = true;
    element('index-status').hidden = true;
    element('workspace').hidden = true;
    element('login').hidden = false;
    input('token').value = '';
    input('password').value = '';
    input(select('login-method').value === 'token' ? 'token' : 'username').focus();
    report('login-status', key, '', key === 'passwordChanged' ? 'success' : key ? 'error' : undefined);
}
async function showWorkspace() {
    const [current, result] = await Promise.all([api<Account>('/auth/me'), api<Project[]>('/projects')]);
    account = current;
    projects = result;
    connected = true;
    element('admin-nav').hidden = current.role !== 'ADMIN';
    element('index-section').hidden = current.role !== 'ADMIN';
    element('index-section').parentElement?.classList.toggle('read-only', current.role !== 'ADMIN');
    element('login').hidden = true;
    element('workspace').hidden = false;
    readRoute();
    report('repositories-status');
}

function showJob(status: IndexJob) {
    const node = element('index-status');
    notes.delete('index-status');
    const key = ({ running: 'indexing', done: 'done', partial: 'partial', error: 'indexError', idle: 'idle' } as Record<string, string>)[status.status];
    node.hidden = false;
    node.dataset.kind = status.status === 'partial' ? 'warning' : status.status === 'error' ? 'error' : status.status === 'done' ? 'success' : '';
    node.replaceChildren(el('strong', t(key ?? 'indexError')));
    if (status.status === 'running' && status.stage) {
        const stage = t({
            scanning: 'indexScanning', parsing: 'indexParsing', embedding: 'indexEmbedding', finalizing: 'indexFinalizing'
        }[status.stage]);
        const { done = 0, total = 0 } = status;
        if (total > 0) {
            node.append(el('span', `${stage} · ${done} / ${total}`));
            const bar = document.createElement('progress');
            bar.max = total;
            bar.value = done;
            bar.setAttribute('aria-label', stage);
            node.append(bar);
        } else {
            node.append(el('span', stage));
        }
        if (status.stage === 'embedding' && status.totalFiles) {
            node.append(el('span', `${t('indexProcessed')} · ${status.processedFiles ?? 0} / ${status.totalFiles}`));
        }
    }
    if (status.parsedFiles !== undefined) {
        node.append(el('span', `${t('filesParsed')} ${status.parsedFiles} · ${t('filesSkipped')} ${status.skippedFiles ?? 0}`));
        if (status.degradedFiles) node.append(el('span', `${t('filesDegraded')} ${status.degradedFiles}`));
        node.append(el('span', `${status.totalUnits ?? 0} ${t('units')} · ${status.totalEdges ?? 0} ${t('relations')}`));
    }
    if (status.errors?.length) {
        const errors = el('ul');
        errors.append(...status.errors.slice(0, 15).map(error => el('li', error)));
        node.append(errors);
    }
}

async function startIndex() {
    const root = input('directory').value.trim();
    if (!root || indexRequest) return;
    const controller = new AbortController();
    indexRequest = controller;
    const submit = element<HTMLFormElement>('index-form').querySelector('button')!;
    submit.disabled = true;
    showJob({ status: 'running' });
    let pollRoot = root;
    try {
        try {
            const result = await api<{ pollUrl: string }>('/index/project', {
                projectRoot: root, noIncremental: String(input('rebuild').checked),
                strategy: select('index-strategy').value,
                includeBytecode: String(input('index-bytecode').checked)
            }, { method: 'POST', signal: controller.signal });
            pollRoot = new URL(result.pollUrl, location.origin).searchParams.get('projectRoot') ?? root;
        } catch (error) {
            if (!(error instanceof RequestError) || error.code !== 'INDEX_ALREADY_RUNNING') throw error;
        }
        while (!controller.signal.aborted) {
            try {
                const job = await api<IndexJob>('/index/project/status', { projectRoot: pollRoot }, { signal: controller.signal });
                if (controller.signal.aborted) break;
                showJob(job);
                if (job.status !== 'running') {
                    await refreshProjects();
                    break;
                }
            } catch (error) {
                if (controller.signal.aborted) break;
                if (error instanceof RequestError && error.status < 500) throw error;
                report('index-status', 'statusRetry', '', 'warning');
            }
            await new Promise(resolve => setTimeout(resolve, 850));
        }
    } catch (error) {
        if (!controller.signal.aborted) showFailure('index-status', error);
    } finally {
        if (indexRequest === controller) indexRequest = undefined;
        submit.disabled = false;
    }
}

function loadArchiveProfile(assetId: string) {
    element('archive-profile').hidden = false;
    void run('profile', signal => readArchiveProfile(assetId, signal), result => {
        archiveOverview = result;
        renderArchiveProfile(result.asset, result.profile);
    });
}

async function waitArchive(asset: ArchiveAsset, signal: AbortSignal, status: string) {
    while (asset.status === 'INDEXING') {
        signal.throwIfAborted();
        report(status, 'indexing', asset.originalFileName);
        await new Promise(resolve => setTimeout(resolve, 700));
        asset = await api<ArchiveAsset>(`/assets/${asset.assetId}`, {}, { signal });
    }
    return asset;
}

async function readArchiveProfile(assetId: string, signal: AbortSignal, started?: ArchiveAsset) {
    const observed = started ?? await api<ArchiveAsset>(`/assets/${assetId}`, {}, { signal });
    const asset = await waitArchive(observed, signal, 'profile-status');
    const profile = asset.status === 'READY' ? await api<ArchiveProfile>(`/assets/${assetId}/profile`, {}, { signal }) : undefined;
    return { asset, profile };
}

async function reindexArchive(asset: ArchiveAsset) {
    if (controllers.has('profile')) return;
    await run('profile', async signal => {
        const started = await api<ArchiveAsset>(`/assets/${asset.assetId}/reindex`, {}, { method: 'POST', signal });
        return readArchiveProfile(asset.assetId, signal, started);
    }, result => {
        archiveOverview = result;
        renderArchiveProfile(result.asset, result.profile);
        void refreshProjects();
        void run('overview', signal => api<ProjectStats>(`/projects/${asset.projectId}/stats`, {}, { signal }), data => {
            overview = data;
            renderOverview(data);
        });
    });
}

function renderArchiveProfile(asset: ArchiveAsset, profile?: ArchiveProfile) {
    const details = el('dl');
    const fields = [
        ['archiveFormat', `${asset.originalFileName} · ${asset.archiveType}`],
        ...(profile ? [
            ['archiveFiles', String(profile.totalFiles)],
            ['categories', Object.entries(profile.categoryDistribution).map(([category, count]) => `${t(category)} ${count}`).join(' · ')],
            ['languageBreakdown', Object.entries(profile.languageDistribution).map(([language, count]) => `${language} ${count}`).join(' · ')],
            ['buildSystems', profile.buildSystems.join(', ')],
            ['sbomComponents', profile.omittedReasons.includes('DEPENDENCY_INVENTORY_UNAVAILABLE') ? '' : String(profile.dependencies.length)],
            ['frameworks', profile.frameworks.join(', ')],
            ['vulnActive', String(Object.values(profile.vulnerabilityCounts).reduce((total, count) => total + count, 0))],
            ['recommendedScanners', profile.scannerPlan.filter(item => item.selected).map(item => item.scanner).join(', ')]
        ] : [])
    ];
    for (const [label, data] of fields) {
        if (data) details.append(el('dt', t(label)), el('dd', data));
    }
    const content = element('profile-content');
    content.replaceChildren(details);
    const actions = el('div', '', 'row-actions');
    for (const [scanner, label] of [['SEMGREP', 'startSemgrep'], ['CODEQL', 'startCodeQl'], ['SLITHER', 'startSlither']]) {
        if (!profile?.scannerPlan.some(item => item.scanner === scanner && item.selected)) continue;
        const scan = resultButton(label, () => {
            if (controllers.has('profile')) return;
            scan.disabled = true;
            void run('profile', signal => api<{ taskId: string }>(`/assets/${asset.assetId}/scan-tasks`, {},
                jsonRequest({ scanners: [scanner] }, 'POST', signal)),
                task => navigate('scan-history', asset.projectId, { task: task.taskId }))
                .finally(() => { scan.disabled = false; });
        });
        actions.append(scan);
    }
    if (account?.role === 'ADMIN') {
        const button = resultButton('archiveReindex', () => {
            if (controllers.has('profile')) return;
            button.disabled = true;
            void reindexArchive(asset).finally(() => { button.disabled = false; });
        });
        actions.append(button);
    }
    if (actions.childElementCount) content.prepend(actions);
    for (const signal of profile?.riskSignals ?? []) {
        const list = el('ul', '', 'hint mono');
        list.append(...signal.evidence.slice(0, 12).map(path => el('li', path)));
        content.append(el('h2', `${t('sensitivePaths')} · ${signal.count}`), list);
    }
    const errors = asset.indexResult?.errors ?? [];
    report('profile-status', asset.status === 'FAILED' ? 'archiveFailed' : errors.length ? 'archivePartial' : 'archiveReady',
        [asset.error, ...errors.slice(0, 3)].filter(Boolean).join(' · '),
        asset.status === 'FAILED' ? 'error' : errors.length ? 'warning' : 'success');
    for (const issue of profile?.dependencyIssues ?? []) content.append(el('p', issue, 'hint'));
    if (profile?.omittedReasons.length) content.append(el('p', profile.omittedReasons.map(t).join(' · '), 'hint'));
}

async function startArchive() {
    const file = input('archive-file').files?.[0];
    if (!file || archiveRequest) return;
    const controller = new AbortController();
    archiveRequest = controller;
    const submit = element<HTMLFormElement>('archive-form').querySelector('button')!;
    submit.disabled = true;
    report('archive-status', 'archiveUploading');
    try {
        const body = new FormData();
        body.append('file', file);
        const started = await api<ArchiveAsset>('/assets/import', {
            strategy: select('archive-strategy').value,
            includeBytecode: String(input('archive-bytecode').checked || /\.jar$/i.test(file.name))
        }, { method: 'POST', body, signal: controller.signal });
        const asset = await waitArchive(started, controller.signal, 'archive-status');
        if (controller.signal.aborted) return;
        const errors = asset.indexResult?.errors ?? [];
        report('archive-status', asset.status === 'FAILED' ? 'archiveFailed' : errors.length ? 'archivePartial' : 'archiveReady',
            [asset.originalFileName, asset.error, ...errors.slice(0, 3)].filter(Boolean).join(' · '),
            asset.status === 'FAILED' ? 'error' : errors.length ? 'warning' : 'success');
        element<HTMLFormElement>('archive-form').reset();
        await refreshProjects();
    } catch (error) {
        if (!controller.signal.aborted) showFailure('archive-status', error);
    } finally {
        if (archiveRequest === controller) archiveRequest = undefined;
        submit.disabled = false;
    }
}

function showSource(unit: CodeUnit, project: string) {
    const dialog = element<HTMLDialogElement>('source-dialog');
    sourceFocus = document.activeElement as HTMLElement | null;
    element('source-title').textContent = unit.qualifiedName;
    element('source-path').textContent = locationLabel(unit, project, unit.metadata.archive_entry);
    element('source-content').textContent = unit.rawSource;
    const location = unit.startLine > 0 ? indexedLocation(unit.filePath, unit.startLine, unit.metadata.archive_entry) : { target: unit.id };
    element<HTMLAnchorElement>('source-link').href = route('graph', project, location);
    element('copy-status').textContent = '';
    if (!dialog.open) dialog.showModal();
}
function indexedLocation(file: string, line: number, archiveEntry?: string): Record<string, string> {
    return { file, line: String(line), ...(archiveEntry ? { archiveEntry } : {}) };
}
function locationLabel(unit: Pick<CodeUnit, 'filePath' | 'startLine' | 'endLine'>, project: string, archiveEntry?: string) {
    const name = projects.find(item => item.projectId === project)?.projectName || project;
    const file = archiveEntry ? unit.filePath + '!/' + archiveEntry : unit.filePath;
    const lines = unit.startLine > 0 ? `:${unit.startLine}${unit.endLine > unit.startLine ? `–${unit.endLine}` : ''}` : '';
    return [name, file + lines].filter(Boolean).join(' · ');
}
function card(hit: Hit) {
    const { unit, projectId } = hit;
    const article = el('article', '', 'surface result');
    const header = el('div', '', 'result-top');
    const label = el('div');
    label.append(el('h2', unit.qualifiedName), el('p', locationLabel(unit, projectId, unit.metadata.archive_entry), 'mono'));
    const actions = el('div', '', 'row-actions');
    actions.append(resultButton(unit.metadata.bytecode === 'true' ? 'openSignature' : 'openSource', () => showSource(unit, projectId)),
        resultButton('graph', () => navigate('graph', projectId, { target: unit.id })));
    header.append(label, actions);
    const score = hit.finalScore ?? hit.score;
    article.append(header, el('span', [unit.kind, unit.language, hit.relation, score && score >= 0.001 ? score.toFixed(3) : '']
        .filter(Boolean).join(' · '), 'kind'));
    if (unit.signature) article.append(el('pre', unit.signature));
    return article;
}
function normalizeResults(value: Hit[] | { results: Hit[] }) { return Array.isArray(value) ? value : value.results; }
function search(append = false) {
    const query = element<HTMLTextAreaElement>('query').value.trim();
    const scope = select('search-scope').value;
    if (!query || (scope === 'current' && !selected)) {
        if (!selected && scope === 'current') report('search-status', 'pickFirst', '', 'warning');
        return;
    }
    const mode = select('search-mode').value;
    const args: Record<string, string> = { [mode === 'code' ? 'snippet' : 'q']: query };
    if (scope === 'current') args.projectId = selected;
    const page = append ? nextPage : { path: `/search/${scope === 'all' ? 'authorized/' : ''}${mode}`, args, offset: 0 };
    if (!page) return;
    const params = { ...page.args };
    if (page.path.endsWith('/semantic') || page.path.endsWith('/code')) params.offset = String(page.offset);
    if (!append) element('search-results').replaceChildren();
    element('next').hidden = true;
    void run('search', signal => api<Hit[] | { results: Hit[]; hasMore?: boolean }>(page.path, params, { signal }), result => {
        const hits = normalizeResults(result);
        element('search-results').append(...hits.map(card));
        nextPage = !Array.isArray(result) && result.hasMore ? { ...page, offset: page.offset + hits.length } : undefined;
        element('next').hidden = !nextPage;
        if (hits.length) report('search-status', 'matches', String(element('search-results').childElementCount));
        else report('search-status', 'noResults');
    });
}
function trace() {
    const target = input('target').value.trim();
    if (!selected || !target) {
        if (!selected) report('graph-status', 'pickFirst', '', 'warning');
        return;
    }
    const relation = select('relation').value;
    const depth = select('depth').value;
    const projectId = selected;
    flowView = undefined;
    element('graph-results').replaceChildren();
    void run('graph', signal => api<CodeUnit[]>(`/graph/${relation}`, { target, depth, projectId }, { signal }), result => {
        if (!result.length) {
            report('graph-status', 'noResults');
            return;
        }
        report('graph-status', 'matches', String(result.length));
        const group = el('section', '', 'surface relationship');
        const direction = relation === 'callers' ? '←' : '→';
        group.append(el('h2', `${t(relation)} ${direction} ${target}`, 'relationship-title'));
        const nodes = el('div', '', 'results');
        nodes.append(...result.map(unit => card({ unit, projectId })));
        group.append(nodes);
        element('graph-results').append(group);
    });
}

function runFlow() {
    const target = input('target').value.trim();
    const projectId = selected;
    if (!projectId || !target) {
        if (!projectId) report('graph-status', 'pickFirst', '', 'warning');
        else input('target').reportValidity();
        return;
    }
    flowView = undefined;
    element('graph-results').replaceChildren();
    void run('graph', signal => api<FlowAnalysis>('/flow/analyze', { target, projectId }, { signal }), result => {
        flowView = { result, nodeId: result.controlFlowGraph.nodes[0].id, includeDependencies: false, projectId };
        renderFlow(flowView);
        report('graph-status');
    });
}

function renderFlow(state: NonNullable<typeof flowView>) {
    const { result, projectId } = state;
    const panel = el('section', '', 'surface relationship');
    panel.append(el('h2', result.target, 'relationship-title'), el('p', result.filePath, 'mono'));
    const fields = el('dl');
    for (const [key, values] of [
        ['flowParameters', result.summary.parameters], ['flowFieldReads', result.summary.fieldReads],
        ['flowFieldWrites', result.summary.fieldWrites], ['flowReturnSources', result.summary.returnSources]
    ] as const) {
        if (values.length) fields.append(el('dt', t(key)), el('dd', values.join(', '), 'mono'));
    }
    if (fields.childElementCount) panel.append(fields);
    if (!result.precise) panel.append(el('p', t('flowConservative'), 'hint'));
    for (const limitation of result.limitations) panel.append(el('p', t(limitation), 'hint'));
    const controls = el('div', '', 'query-form');
    const nodes = result.controlFlowGraph.nodes;
    const label = (node: FlowAnalysis['controlFlowGraph']['nodes'][number]) => {
        const kind = t('flowNode' + node.kind);
        return [String(node.line), kind, node.label !== node.kind ? node.label : ''].filter(Boolean).join(' · ');
    };
    const picker = document.createElement('select');
    picker.replaceChildren(...nodes.map(node => new Option(label(node), node.id)));
    picker.value = state.nodeId;
    const pickerLabel = el('label', '', 'field-grow');
    pickerLabel.append(el('span', t('flowStep')), picker);
    controls.append(pickerLabel);
    let graphPicker: HTMLSelectElement | undefined;
    if (result.programDependenceGraph) {
        graphPicker = document.createElement('select');
        graphPicker.replaceChildren(new Option(t('flowControl'), 'cfg'), new Option(t('flowDependence'), 'pdg'));
        graphPicker.value = state.includeDependencies ? 'pdg' : 'cfg';
        const graphLabel = el('label');
        graphLabel.append(el('span', t('graph')), graphPicker);
        controls.append(graphLabel);
    }
    const detail = el('div', '', 'stack');
    const byId = new Map(nodes.map(node => [node.id, node]));
    function refresh() {
        state.nodeId = picker.value;
        state.includeDependencies = graphPicker?.value === 'pdg';
        const chosen = byId.get(state.nodeId)!;
        const graph = state.includeDependencies ? result.programDependenceGraph! : result.controlFlowGraph;
        const connections = graph.edges.filter(edge => edge.sourceId === chosen.id || edge.targetId === chosen.id);
        const toButton = (id: string) => {
            const button = el('button', label(byId.get(id)!)) as HTMLButtonElement;
            button.type = 'button';
            button.addEventListener('click', () => { picker.value = id; refresh(); picker.focus(); });
            return button;
        };
        detail.replaceChildren(resultButton('openSource', () =>
            navigate('graph', projectId, { file: result.filePath, line: String(chosen.line) })));
        if (connections.length) detail.append(qualityTable(['flowFrom', 'relation', 'flowTo'],
            connections.slice(0, 100).map(edge => [toButton(edge.sourceId),
                [t(edge.kind), edge.symbol].filter(Boolean).join(' · '), toButton(edge.targetId)])));
        else detail.append(el('p', t('flowNoEdges'), 'hint'));
        if (connections.length > 100) detail.append(el('p', t('flowEdgeLimit'), 'hint'));
    }
    picker.addEventListener('change', refresh);
    graphPicker?.addEventListener('change', refresh);
    refresh();
    panel.append(controls, detail);
    element('graph-results').replaceChildren(panel);
}
function syncLocateArchive() {
    const active = /\.jar$/i.test(input('file').value.trim());
    element('locate-archive').hidden = !active;
    input('locate-archive-entry').required = active;
}
function locate(file: string, line: number, project: string, archiveEntry?: string) {
    if (!project) {
        report('locate-status', 'pickFirst', '', 'warning');
        return;
    }
    void run('locate', signal => api<CodeUnit>('/locate', {
        ...indexedLocation(file, line, /\.jar$/i.test(file) ? archiveEntry : undefined), projectId: project
    }, { signal }), unit => {
        report('locate-status');
        showSource(unit, project);
    });
}
function buildPack() {
    const q = input('evidence-query').value.trim();
    if (!selected) {
        report('evidence-status', 'pickFirst', '', 'warning');
        return;
    }
    if (!q) return;
    element('evidence-results').replaceChildren();
    void run('evidence', signal => api<Pack>('/context/pack', {
        q, projectId: selected, budgetChars: input('budget').value
    }, { signal }), result => {
        const brief = result.omittedReasons.map(reason => messagesByCode[reason] ? t(messagesByCode[reason]) : reason);
        report('evidence-status', 'excerptBudget',
            `${result.usedBudgetChars}/${result.requestedBudgetChars}${brief.length ? ` · ${brief.join(' · ')}` : ''}`,
            brief.length ? 'warning' : undefined);
        element('evidence-results').replaceChildren(...result.evidence.map(evidence => {
            const item = el('article', '', 'surface result');
            const header = el('div', '', 'result-top');
            const label = el('div');
            label.append(el('h2', `${evidence.citationId} · ${evidence.qualifiedName}`),
                el('p', locationLabel(evidence, evidence.projectId, evidence.archiveEntry), 'mono'));
            const action = evidence.startLine <= 0 ? 'graph' : evidence.bytecode ? 'openSignature' : 'openSource';
            header.append(label, resultButton(action, () => {
                navigate('graph', evidence.projectId, evidence.startLine > 0
                    ? indexedLocation(evidence.filePath, evidence.startLine, evidence.archiveEntry)
                    : { target: evidence.unitId ?? evidence.qualifiedName });
            }));
            item.append(header, el('span', [evidence.kind, evidence.source, evidence.relation,
                evidence.truncated ? t('truncated') : ''].filter(Boolean).join(' · '), 'kind'),
            el('pre', evidence.excerpt));
            return item;
        }));
    });
}

function options(id: string, items: [string, string][], prompt?: string) {
    const control = select(id);
    const previous = control.value;
    control.replaceChildren(...(prompt ? [new Option(t(prompt), '')] : []),
        ...items.map(([key, label]) => new Option(label, key)));
    if (items.some(([key]) => key === previous)) control.value = previous;
}

function loadAdministration() {
    if (account?.role !== 'ADMIN') return;
    if (element<HTMLDetailsElement>('provider-panel').open) loadProviders();
    void run('admin', async signal => {
        const [accounts, organizations, projects, audit] = await Promise.all([
            api<Account[]>('/admin/accounts', {}, { signal }),
            api<Organization[]>('/admin/organizations', {}, { signal }),
            api<ManagedProject[]>('/admin/projects', {}, { signal }),
            api<AuditEvent[]>('/admin/audit', { limit: '30' }, { signal })
        ]);
        return { accounts, organizations, projects, audit };
    }, result => {
        administration = result;
        renderAdministration(result);
        selectOrganization();
        report('admin-status');
    });
}

function renderProviderChoices(preferred?: string) {
    const choices = providers.map(profile => [profile.id, profile.name + (profile.selected ? ' · ' + t('providerSelected') : '')] as [string, string]);
    options('provider-profile', choices, 'providerNew');
    if (preferred !== undefined) select('provider-profile').value = preferred;
    const profile = providers.find(item => item.id === select('provider-profile').value);
    element('provider-key-state').textContent = profile?.apiKeyConfigured ? t('providerKeySaved') : '';
    element<HTMLButtonElement>('provider-test').disabled = !profile;
    element<HTMLButtonElement>('provider-select').disabled = !profile?.enabled || profile.selected;
    element<HTMLButtonElement>('provider-delete').disabled = !profile || profile.selected;
    input('provider-clear-key').disabled = !profile?.apiKeyConfigured;
}

function fillProvider() {
    const profile = providers.find(item => item.id === select('provider-profile').value);
    const protocol = profile?.protocol ?? 'OLLAMA';
    select('provider-protocol').value = protocol;
    input('provider-name').value = profile?.name ?? '';
    input('provider-url').value = profile?.baseUrl ?? providerTemplates[protocol];
    input('provider-model').value = profile?.model ?? '';
    input('provider-timeout').value = String(profile?.timeoutMillis ?? 30_000);
    input('provider-tokens').value = String(profile?.maxOutputTokens ?? 4096);
    input('provider-input-price').value = String(profile?.inputUsdPerMillionTokens ?? '');
    input('provider-output-price').value = String(profile?.outputUsdPerMillionTokens ?? '');
    input('provider-enabled').checked = profile?.enabled ?? false;
    input('provider-clear-key').checked = false;
    input('provider-key').value = '';
    element('provider-models').replaceChildren();
    renderProviderChoices();
}

function loadProviders(preferred?: string) {
    if (account?.role !== 'ADMIN') return;
    void run('provider-list', signal => api<ModelProvider[]>(modelProvidersPath, {}, { signal }), result => {
        const firstLoad = element('provider-form').hidden;
        providers = result;
        renderProviderChoices(preferred ?? (firstLoad ? result.find(profile => profile.selected)?.id : undefined));
        if (firstLoad || preferred !== undefined) fillProvider();
        element('provider-form').hidden = false;
        report('provider-list-status');
    });
}

function providerDraft() {
    const amount = (id: string) => input(id).value === '' ? null : input(id).valueAsNumber;
    return { providerId: select('provider-profile').value || null, name: input('provider-name').value,
        protocol: select('provider-protocol').value, baseUrl: input('provider-url').value, model: input('provider-model').value,
        apiKey: input('provider-key').value, clearApiKey: input('provider-clear-key').checked, enabled: input('provider-enabled').checked,
        timeoutMillis: input('provider-timeout').valueAsNumber, maxOutputTokens: input('provider-tokens').valueAsNumber,
        inputUsdPerMillionTokens: amount('provider-input-price'), outputUsdPerMillionTokens: amount('provider-output-price') };
}

function renderAdministration(data: Administration) {
    const { accounts, organizations, projects, audit } = data;
    element('account-list').replaceChildren(...accounts.map(entry => {
        const row = el('div');
        row.append(el('strong', `${entry.displayName} · ${entry.username}`), el('p', t(entry.status)));
        return row;
    }));
    element('audit-list').replaceChildren(...audit.map(event => {
        const row = el('div');
        const actor = accounts.find(entry => entry.id === event.actorId)?.username ?? event.actorId;
        row.append(el('strong', event.action),
            el('p', [new Date(event.createdAt).toLocaleString(language), actor, event.reason].filter(Boolean).join(' · ')));
        return row;
    }));
    options('review-account', accounts.filter(entry => entry.role !== 'ADMIN').map(entry =>
        [entry.id, `${entry.username} · ${t(entry.status)}`]), 'chooseAccount');
    options('managed-org', organizations.map(entry => [entry.id, entry.name]), 'newOrganization');
    options('member-account', accounts.map(entry => [entry.id, entry.username]), 'chooseAccount');
    options('owner-project', projects.map(entry => [entry.project.projectId, entry.project.projectName]), 'choose');
    showReviewOptions();
    chooseOwnerProject();
}

function showReviewOptions() {
    const selected = administration?.accounts.find(entry => entry.id === select('review-account').value);
    const choices = selected?.status === 'PENDING' ? ['ACTIVE', 'REJECTED']
        : selected?.status === 'ACTIVE' ? ['DISABLED'] : selected ? ['ACTIVE'] : [];
    options('review-decision', choices.map(status => [status, t(status)]));
}

function selectOrganization() {
    const org = administration?.organizations.find(item => item.id === select('managed-org').value);
    input('org-name').value = org?.name ?? '';
    input('org-active').checked = org?.active ?? true;
    element('membership-form').hidden = !org;
    organizationMembers = [];
    controllers.get('admin-members')?.abort();
    element('members-list').replaceChildren();
    report('admin-members-status');
    if (!org) return;
    selectedMembership();
    void run('admin-members', signal => api<Account[]>(`/admin/organizations/${org.id}/members`, {}, { signal }), result => {
        organizationMembers = result;
        element('members-list').replaceChildren(el('p', result.length
            ? result.map(entry => entry.username).join(', ') : t('noMembers'), 'hint'));
        selectedMembership();
        report('admin-members-status');
    });
}

function selectedMembership() {
    input('member-present').checked = organizationMembers.some(entry => entry.id === select('member-account').value);
}

function chooseOwnerProject() {
    const project = administration?.projects.find(item => item.project.projectId === select('owner-project').value);
    const owner = project?.owner;
    const name = owner?.ownerType === 'PERSONAL'
        ? administration?.accounts.find(entry => entry.id === owner.ownerId)?.username
        : administration?.organizations.find(entry => entry.id === owner?.ownerId)?.name;
    element('current-owner').textContent = !project ? '' : owner ? `${t('owner')} · ${name ?? owner.ownerId}` : t('unassigned');
    if (owner) select('owner-type').value = owner.ownerType;
    ownerOptions(owner?.ownerId);
}

function ownerOptions(existing?: string) {
    const items: [string, string][] = select('owner-type').value === 'PERSONAL'
        ? administration?.accounts.filter(item => item.status === 'ACTIVE').map(item => [item.id, item.username]) ?? []
        : administration?.organizations.filter(item => item.active).map(item => [item.id, item.name]) ?? [];
    options('owner-target', items, 'chooseOwner');
    select('owner-target').value = existing ?? '';
}

function saveAdministration(path: string, method: string, data: unknown, onSaved?: (result: unknown) => void) {
    if (controllers.has('admin-write')) return;
    void run('admin-write', signal => api(path, {}, jsonRequest(data, method, signal)), result => {
        onSaved?.(result);
        report('admin-write-status', 'saved', '', 'success');
        loadAdministration();
    });
}

function form(id: string, submit: () => void) {
    element(id).addEventListener('submit', event => {
        event.preventDefault();
        submit();
    });
}

for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-view]')) {
    link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        navigate(link.dataset.view as View);
    });
}
window.addEventListener('popstate', readRoute);
element('benchmark-refresh').addEventListener('click', () => void loadBenchmark());
element('wiki-generate').addEventListener('click', () => void trackWiki());
select('wiki-select').addEventListener('change', () => {
    const id = select('wiki-select').value;
    if (wikiSummary) select('wiki-select').value = wikiSummary.document.id;
    const runId = new URL(location.href).searchParams.get('run');
    navigate('wiki', selected, { document: id, ...(isUuid(runId) ? { run: runId } : {}) });
});
select('project').addEventListener('change', () => navigate(view, select('project').value));
select('triage-mode').addEventListener('change', () => loadTriageTargets());
select('triage-target').addEventListener('change', renderTriageControls);
input('triage-file').addEventListener('change', renderTriageControls);
element('triage-refresh').addEventListener('click', () => loadTriageWorkspace(new URL(location.href).searchParams));
element('triage-cancel').addEventListener('click', () => {
    const current = triageRun;
    if (!current || !activeAgent(current) || controllers.has('triage-cancel')) return;
    void run('triage-cancel', signal => api<AgentRun>('/agent-runs/' + current.id + '/cancel',
        { projectId: current.projectId }, { method: 'POST', signal }), cancelled => {
        if (triageRun?.id !== cancelled.id) return;
        controllers.get('triage-run')?.abort();
        showTriageRun(cancelled);
        report('triage-cancel-status');
        report('triage-run-status');
    });
});
form('triage-form', () => {
    const projectId = selected;
    const mode = select('triage-mode').value;
    const file = input('triage-file').files?.[0];
    const target = select('triage-target').value;
    if (!projectId || controllers.has('triage-submit') || (mode === 'upload' ? !file : !target)) return;
    const budgetChars = input('triage-budget').value;
    const codeVersion = input('triage-code-version').value.trim();
    const ruleVersion = input('triage-rule-version').value.trim();
    const versions = { ...(codeVersion ? { codeVersion } : {}), ...(ruleVersion ? { ruleVersion } : {}) };
    const args = { projectId, ...(budgetChars ? { budgetChars } : {}) };
    void run('triage-submit', signal => {
        if (mode === 'upload') return api<AgentRun>('/agent-runs/sast-triage', {
            ...args, ...versions, format: select('triage-format').value
        }, { method: 'POST', body: file, headers: { 'Content-Type': 'application/json' }, signal });
        if (mode === 'vulnerability') return api<AgentRun>('/agent-runs/vulnerability-triage', {
            ...args, ...versions, vulnerabilityId: target
        }, { method: 'POST', signal });
        return api<AgentRun>('/agent-runs/sast-triage', args, jsonRequest({ fingerprints: [target] }, 'POST', signal));
    }, accepted => {
        report('triage-submit-status');
        showTriageRun(accepted);
        element<HTMLDetailsElement>('triage-setup').open = false;
        selectTriageRun(accepted.id, projectId);
    }).finally(renderTriageControls);
    renderTriageControls();
});
element('menu').addEventListener('click', () => {
    const opened = element('sidebar').classList.toggle('open');
    element('menu').setAttribute('aria-expanded', String(opened));
    if (opened) document.querySelector<HTMLElement>('nav a[aria-current]')?.focus();
});
element('sidebar').addEventListener('keydown', event => {
    if (event.key === 'Escape' && element('sidebar').classList.contains('open')) {
        closeMenu();
        element('menu').focus();
    }
});
element('language').addEventListener('click', () => {
    language = language === 'en' ? 'zh' : 'en';
    preference('language', language);
    localize();
});
element('theme').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    preference('theme', theme);
    localize();
});
element('refresh').addEventListener('click', () => void refreshProjects());
element('overview-search').addEventListener('click', () => {
    select('search-scope').value = 'current';
    navigate('search');
});
element('quality-form').addEventListener('submit', event => {
    event.preventDefault();
    const projectId = selected;
    const measure = select('quality-measure').value as QualityMeasure;
    if (!projectId || !Object.hasOwn(qualityPaths, measure)) return;
    quality = undefined;
    element('quality-content').replaceChildren();
    void run('quality', signal => measure === 'architecture' ? streamArchitecture(projectId, signal)
        : api(qualityPaths[measure], { projectId }, { signal }), result => {
        quality = { measure, result };
        renderQuality(measure, result);
        report('quality-status');
    });
});
select('quality-measure').addEventListener('change', () => {
    controllers.get('quality')?.abort();
    quality = undefined;
    element('quality-content').replaceChildren();
    report('quality-status');
});
form('findings-form', () => {
    const projectId = selected;
    const file = input('findings-file').files?.[0];
    if (!projectId) { report('finding-import-status', 'pickFirst', '', 'warning'); return; }
    if (!file) return;
    const args = { projectId, format: select('findings-format').value, codeVersion: input('findings-version').value,
        ruleVersion: input('findings-rule-version').value };
    void run('finding-import', signal => api<ReturnType<ExternalFindings['import']>>('/triage/findings/import', args, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file, signal
    }), result => {
        input('findings-file').value = '';
        const skipped = result.reported - result.imported - result.duplicates;
        const summary = [`${t('findingImported')} ${result.imported}`, `${t('findingDuplicates')} ${result.duplicates}`,
            `${t('findingSkipped')} ${skipped}`];
        report('finding-import-status', summary[0], summary.slice(1).join(' · '), skipped ? 'warning' : 'success');
        loadFindings(0);
    });
});
for (const [button, direction] of [['findings-previous', -1], ['findings-next', 1]] as const) {
    element(button).addEventListener('click', () => {
        if (findingList) loadFindings(Math.max(0, findingList.offset + direction * findingList.limit));
    });
}
select('queue-filter').addEventListener('change', () => loadQueue(0));
const inventoryScanButtons = [element<HTMLButtonElement>('code-scan'), element<HTMLButtonElement>('taint-scan')];
function scanInventory(kind: 'code' | 'taint') {
    const projectId = selected;
    if (!projectId) { report('inventory-scan-status', 'pickFirst', '', 'warning'); return; }
    if (controllers.has('inventory-scan')) return;
    inventoryScanButtons.forEach(button => { button.disabled = true; });
    void run('inventory-scan', async signal => {
        let offset: number | null = 0;
        let indexVersion: string | undefined;
        let checked = 0, found = 0;
        let partial = false;
        while (offset !== null) {
            const args: Record<string, string> = { projectId, offset: String(offset), ...(indexVersion ? { indexVersion } : {}) };
            const result = await api<{ scannedUnits?: number; entryPoints?: number; truncated?: boolean; skippedSources?: number;
                newFindings: number; nextOffset: number | null; indexVersion: string }>(
                '/vulns/scan/' + kind, args, { method: 'POST', signal });
            checked += result.scannedUnits ?? result.entryPoints ?? 0;
            found += result.newFindings;
            partial ||= !!result.truncated || !!result.skippedSources;
            offset = result.nextOffset;
            indexVersion = result.indexVersion;
        }
        return { checked, found, partial };
    }, ({ checked, found, partial }) => {
        const label = kind === 'code' ? 'codeScanComplete' : partial ? 'taintScanPartial' : 'taintScanComplete';
        const units = t(kind === 'code' ? 'codeScanChecked' : 'taintScanChecked');
        report('inventory-scan-status', label, `${units} ${checked} · ${t('codeScanNew')} ${found}`, partial ? 'warning' : 'success');
        loadVulnerabilities(0);
    }).finally(() => inventoryScanButtons.forEach(button => { button.disabled = false; }));
}
inventoryScanButtons[0].addEventListener('click', () => scanInventory('code'));
inventoryScanButtons[1].addEventListener('click', () => scanInventory('taint'));
for (const filter of ['vuln-filter', 'vuln-severity']) select(filter).addEventListener('change', () => loadVulnerabilities(0));
for (const [button, direction] of [['vuln-previous', -1], ['vuln-next', 1]] as const) {
    element(button).addEventListener('click', () => {
        if (vulnPage) loadVulnerabilities(Math.max(0, vulnPage.offset + direction * vulnPageSize));
    });
}
for (const [button, direction] of [['queue-previous', -1], ['queue-next', 1]] as const) {
    element(button).addEventListener('click', () => {
        if (queuePage) loadQueue(Math.max(0, queuePage.page + direction));
    });
}
element('queue-batch').addEventListener('click', () => {
    if (!selected || !queueSelected.size || controllers.has('queue-batch')) return;
    const input = { snapshotIds: [...queueSelected], format: select('queue-export-format').value };
    void run('queue-batch', signal => api<Blob>('/review-queue/snapshots/export-batch', { projectId: selected },
        jsonRequest(input, 'POST', signal), 'blob'), archive => {
        download('snapshots-export.zip', archive, 'application/zip');
        report('queue-batch-status');
    });
});
element('change-form').addEventListener('submit', event => {
    event.preventDefault();
    const projectId = selected;
    if (!projectId) { report('change-status', 'pickFirst', '', 'warning'); return; }
    const diff = element<HTMLTextAreaElement>('change-diff');
    loadChangeReview(null);
    void run('change', signal => api<ChangeSnapshot>('/change-reviews', {}, jsonRequest({ projectId, diff: diff.value,
        baseVersion: input('change-base').value, targetVersion: input('change-target').value, source: 'workbench' }, 'POST', signal)), snapshot => {
        changeSnapshot = snapshot;
        diff.value = '';
        history.replaceState(null, '', route('change-review', projectId, { snapshot: snapshot.id }));
        renderChangeReview(snapshot);
        report('change-status');
    });
});
element('change-model-start').addEventListener('click', () => {
    if (changeSnapshot && !activeAgent(changeRun)) {
        report('change-cancel-status');
        void trackChangeRun(changeSnapshot);
    }
});
element('change-model-cancel').addEventListener('click', () => {
    const current = changeRun;
    if (!current || !activeAgent(current)) return;
    void run('change-cancel', signal => api<AgentRun>(`/agent-runs/${current.id}/cancel`, { projectId: current.projectId }, {
        method: 'POST', signal
    }), cancelled => {
        controllers.get('change-model')?.abort();
        report('change-model-status');
        report('change-cancel-status');
        renderChangeRun(cancelled);
    });
});
for (const [button, format] of [['change-export-json', 'json'], ['change-export-md', 'markdown']]) {
    element(button).addEventListener('click', () => {
        const snapshot = changeSnapshot;
        if (!snapshot || snapshot.projectId !== selected) return;
        void run('change-export', signal => api<string>(`/change-reviews/${snapshot.id}/export`, { projectId: selected, format }, { signal }, 'text'), result => {
            download('change-review-' + snapshot.id + (format === 'json' ? '.json' : '.md'), result,
                format === 'json' ? 'application/json' : 'text/markdown');
            report('change-export-status');
        });
    });
}
for (const format of ['dot', 'mermaid']) element('export-' + format).addEventListener('click', () => {
    const projectId = selected;
    if (!projectId) return;
    void run('graph-export', signal => api<string>('/export/graph', { projectId, format }, { signal }, 'text'), result => {
        download('repograph-' + projectId + (format === 'dot' ? '.dot' : '.mmd'), result, 'text/plain');
        report('graph-export-status');
    });
});
element('watch-toggle').addEventListener('click', async () => {
    const project = projects.find(item => item.projectId === selected);
    if (!project || project.assetId || watchState === undefined || watchBusy || account?.role !== 'ADMIN') return;
    const wasWatching = watchState;
    watchBusy = true;
    renderWatch();
    await run('watch', signal => wasWatching
        ? api<void>(`/watch/${project.projectId}`, {}, { method: 'DELETE', signal })
        : api('/watch', { projectId: project.projectId, root: project.projectRoot }, { method: 'POST', signal }), () => {
        watchState = !wasWatching;
        report('watch-status');
    });
    if (selected === project.projectId && view === 'overview') {
        watchBusy = false;
        renderWatch();
    }
});
element('sbom-preview').addEventListener('click', () => {
    const id = selected;
    if (!id) return;
    sbom = undefined;
    element('sbom-download').hidden = true;
    element('sbom-content').replaceChildren();
    void run('sbom', signal => api<Sbom>(`/sbom/${id}`, {}, { signal }), result => {
        sbom = result;
        renderSbom(result);
    });
});
element('sbom-download').addEventListener('click', () => {
    if (!sbom || !selected) return;
    download(`repograph-${selected}.cdx.json`, JSON.stringify(sbom, null, 2) + '\n', 'application/json');
});
element('dependency-scan').addEventListener('click', () => {
    if (!selected || controllers.has('dependency-scan')) return;
    dependencyScan = undefined;
    element('dependency-scan-content').replaceChildren();
    void run('dependency-scan', signal => api<DependencyScanResult>('/vulns/scan/deps', { projectId: selected },
        { method: 'POST', signal }), result => {
        dependencyScan = result;
        renderDependencyScan(result);
    });
});
function download(name: string, content: string | Blob, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
element('disconnect').addEventListener('click', async () => {
    try {
        await api('/web/session', {}, { method: 'DELETE' });
        showLogin();
    } catch (error) {
        showFailure('connection-status', error);
    }
});

function selectLoginMethod() {
    const tokenMode = select('login-method').value === 'token';
    element('token-credentials').hidden = !tokenMode;
    element('account-credentials').hidden = tokenMode;
    for (const id of ['token', 'username', 'password']) {
        const field = input(id);
        field.disabled = tokenMode ? id !== 'token' : id === 'token';
        field.required = !field.disabled;
    }
    input('password').value = '';
    input('token').value = '';
    report('login-status');
}
select('login-method').addEventListener('change', selectLoginMethod);

form('login-form', () => {
    const tokenMode = select('login-method').value === 'token';
    const button = element<HTMLFormElement>('login-form').querySelector('button')!;
    if (button.disabled) return;
    button.disabled = true;
    report('login-status', 'load');
    const request = tokenMode
        ? api('/web/session', {}, { method: 'POST', headers: { Authorization: `Bearer ${input('token').value.trim()}` } })
        : api('/auth/login', {}, jsonRequest({ username: input('username').value, password: input('password').value }));
    input('token').value = '';
    input('password').value = '';
    void request.then(showWorkspace).catch(error => {
        if (error instanceof RequestError && error.status === 401) {
            report('login-status', tokenMode ? 'wrongToken' : 'invalidCredentials', '', 'error');
        } else showFailure('login-status', error);
        input(tokenMode ? 'token' : 'password').focus();
    }).finally(() => { button.disabled = false; });
});
form('registration-form', () => {
    const username = input('register-username').value;
    const body = {
        username, displayName: input('register-name').value, email: input('register-email').value,
        password: input('register-password').value
    };
    input('register-password').value = '';
    void run('registration', signal => api('/auth/register', {}, jsonRequest(body, 'POST', signal)), () => {
        select('login-method').value = 'account';
        selectLoginMethod();
        input('username').value = username;
        report('registration-status', 'pendingApproval', '', 'success');
    });
});
element('account-button').addEventListener('click', () => {
    if (!account) return;
    element('account-details').textContent = `${account.displayName} · ${account.username}`;
    element<HTMLDialogElement>('account-dialog').showModal();
});
form('password-form', () => {
    const body = { oldPassword: input('old-password').value, newPassword: input('new-password').value };
    input('old-password').value = '';
    input('new-password').value = '';
    report('password-status', 'load');
    void api('/auth/password', {}, jsonRequest(body)).then(() => showLogin('passwordChanged')).catch(error => {
        if (error instanceof RequestError && error.code === 'INVALID_CREDENTIALS') {
            report('password-status', 'invalidCredentials', '', 'error');
        } else showFailure('password-status', error);
    });
});

element('admin-refresh').addEventListener('click', loadAdministration);
element<HTMLDetailsElement>('provider-panel').addEventListener('toggle', () => {
    if (view === 'admin' && element<HTMLDetailsElement>('provider-panel').open) loadProviders();
    else { input('provider-key').value = ''; controllers.get('provider-write')?.abort(); }
});
select('provider-profile').addEventListener('change', () => {
    controllers.get('provider-write')?.abort();
    report('provider-write-status');
    fillProvider();
});
select('provider-protocol').addEventListener('change', () => {
    const url = input('provider-url');
    const protocol = select('provider-protocol').value as GenerationProtocol;
    if (!url.value || Object.values(providerTemplates).includes(url.value)) url.value = providerTemplates[protocol];
    element('provider-models').replaceChildren();
});
for (const id of ['provider-url', 'provider-key', 'provider-clear-key']) {
    element(id).addEventListener('input', () => element('provider-models').replaceChildren());
}
form('provider-form', () => {
    const draft = providerDraft();
    const path = draft.providerId ? `${modelProvidersPath}/${draft.providerId}` : modelProvidersPath;
    void run('provider-write', signal => api<ModelProvider>(path, {}, jsonRequest(draft, draft.providerId ? 'PUT' : 'POST', signal)), result => {
        input('provider-key').value = '';
        report('provider-write-status', 'saved', '', 'success');
        loadProviders(result.id);
    });
});
element('provider-discover').addEventListener('click', () => {
    if (!input('provider-url').reportValidity() || !input('provider-timeout').reportValidity()) return;
    const draft = providerDraft();
    void run('provider-write', signal => api<{ models: string[] }>(modelProvidersPath + '/models', {}, jsonRequest(draft, 'POST', signal)), result => {
        const current = providerDraft();
        if (draft.baseUrl !== current.baseUrl || draft.protocol !== current.protocol || draft.apiKey !== current.apiKey
            || draft.clearApiKey !== current.clearApiKey) { report('provider-write-status'); return; }
        element('provider-models').replaceChildren(...result.models.map(model => new Option(model, model)));
        report('provider-write-status', 'providerModelsFound', String(result.models.length), 'success');
    });
});
element('provider-test').addEventListener('click', () => {
    const id = select('provider-profile').value;
    if (!id) return;
    void run('provider-write', signal => api<{ connected: boolean; message: string }>(`${modelProvidersPath}/${id}/test`, {}, {
        method: 'POST', signal
    }), result => report('provider-write-status', result.message, '', result.connected ? 'success' : 'error'));
});
element('provider-select').addEventListener('click', () => {
    const id = select('provider-profile').value;
    if (!id) return;
    void run('provider-write', signal => api(`${modelProvidersPath}/${id}/select`, {}, { method: 'POST', signal }), () => {
        report('provider-write-status', 'saved', '', 'success');
        loadProviders(id);
    });
});
element('provider-delete').addEventListener('click', () => {
    const id = select('provider-profile').value;
    if (!id || !window.confirm(t('providerDeleteConfirm'))) return;
    void run('provider-write', signal => api(`${modelProvidersPath}/${id}`, {}, { method: 'DELETE', signal }), () => {
        report('provider-write-status', 'saved', '', 'success');
        loadProviders('');
    });
});
select('review-account').addEventListener('change', showReviewOptions);
select('managed-org').addEventListener('change', selectOrganization);
select('member-account').addEventListener('change', selectedMembership);
select('owner-project').addEventListener('change', chooseOwnerProject);
select('owner-type').addEventListener('change', () => ownerOptions());
form('review-form', () => saveAdministration(
    `/admin/accounts/${select('review-account').value}/review`, 'POST',
    { status: select('review-decision').value, reason: input('review-reason').value },
    () => { input('review-reason').value = ''; }
));
form('organization-form', () => {
    const id = select('managed-org').value;
    saveAdministration(id ? `/admin/organizations/${id}` : '/admin/organizations', id ? 'PUT' : 'POST',
        { name: input('org-name').value, active: input('org-active').checked });
});
form('membership-form', () => saveAdministration(
    `/admin/organizations/${select('managed-org').value}/members/${select('member-account').value}`, 'PUT',
    { member: input('member-present').checked }
));
form('owner-form', () => saveAdministration(
    `/admin/projects/${select('owner-project').value}/owner`, 'PUT',
    { ownerType: select('owner-type').value, ownerId: select('owner-target').value }
));
form('index-form', () => void startIndex());
form('archive-form', () => void startArchive());
form('search-form', () => search());
form('graph-form', trace);
element('flow-analyze').addEventListener('click', runFlow);
input('file').addEventListener('input', syncLocateArchive);
form('locate-form', () => locate(input('file').value.trim(), input('line').valueAsNumber, selected,
    input('locate-archive-entry').value.trim()));
form('evidence-form', buildPack);
element('next').addEventListener('click', () => search(true));

for (const [panel, names] of [
    ['search', ['query', 'search-mode', 'search-scope']], ['graph', ['target', 'relation', 'depth']],
    ['evidence', ['evidence-query', 'budget']]
] as const) {
    for (const name of names) element(name).addEventListener('input', () => {
        controllers.get(panel)?.abort();
        element(`${panel}-results`).replaceChildren();
        report(`${panel}-status`);
        if (panel === 'search') {
            nextPage = undefined;
            element('next').hidden = true;
        }
    });
}
for (const name of ['file', 'line']) element(name).addEventListener('input', () => {
    controllers.get('locate')?.abort();
    report('locate-status');
});

element('source-dialog').addEventListener('close', () => {
    if (sourceFocus?.isConnected && !sourceFocus.closest('[hidden]')) sourceFocus.focus();
    sourceFocus = null;
    element('source-content').textContent = '';
});
element('copy').addEventListener('click', async () => {
    const message = element('copy-status');
    try {
        await navigator.clipboard.writeText(element('source-content').textContent ?? '');
        message.textContent = t('copied');
    } catch {
        message.textContent = t('copyFailed');
    }
});

localize();
selectLoginMethod();
void showWorkspace().catch(error => {
    showLogin(error instanceof RequestError && error.status === 401 ? '' : 'noNetwork');
});

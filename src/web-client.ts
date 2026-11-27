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
import type { GraphDiagram } from './graph.js';
import type { JobAction } from './durable-jobs.js';
import type { KnowledgeSnapshots, SnapshotMode } from './knowledge-snapshots.js';
import type { searchKnowledge } from './knowledge-search.js';
import type { GenerationProtocol, ModelProvider } from './model-providers.js';
import type { diagnosticReport } from './operability.js';
import type { SummaryDocument, WikiSummaries } from './wiki.js';
import type { WikiPerspective } from './wiki-facts.js';
import type { WikiPages } from './wiki-pages.js';
import type { ExternalFindings, findingReport } from './external-findings.js';
import type { ExternalFinding } from './finding-import.js';
import type { ReviewQueue, ReviewQueueEntry, ReviewAction } from './review-queue.js';
import type { ArchivedScannerRun, ArchivedScannerSummary, ArchivedScanTask, ScanFindingsPage, ScanHistoryPage } from './scan-history.js';
import type { TriageAdvisory } from './triage-advisory.js';
import type { VulnerabilityFinding, VulnerabilityInventory, VulnerabilityStatus } from './vulnerability-inventory.js';
import { bindLanguageSwitch, preference, preferredLanguage, setDocumentLanguage } from './web-locale.js';
import { DocumentReader } from './document-reader.js';
import type { ReaderSource } from './document-reader.js';
import type { ProjectSpaces } from './project-spaces.js';
import type { spaceDocumentGeneration } from './project-space-input.js';
import type { SnapshotRetirement } from './snapshot-retirement.js';
import type { GitSources } from './git-sources.js';

type View = 'repositories' | 'spaces' | 'overview' | 'search' | 'graph' | 'evidence' | 'ask' | 'wiki' | 'findings' | 'review-queue' | 'vulnerabilities'
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
type Severity = 'error' | 'warning' | 'success';
interface Project {
    projectId: string; projectName: string; projectRoot: string; nodeCount: number; indexedAt: string; assetId?: string;
    git?: { url: string; branch: string };
}
interface DashboardProject extends Project {
    fileCount: number; mainLanguage: string | null; archiveName?: string;
    indexStatus: 'done' | 'running' | 'partial' | 'error' | 'idle';
    canManage?: boolean;
}
type ProjectLifecycle = ReturnType<import('./project-retirement.js').ProjectRetirement['describe']>;
type ProjectTrash = ReturnType<import('./project-retirement.js').ProjectRetirement['list']>;
interface Hit { unit: CodeUnit; projectId: string; snapshotId?: string; score?: number; finalScore?: number; relation?: string }
type KnowledgeResults = Awaited<ReturnType<typeof searchKnowledge>>;
type KnowledgeScope = Parameters<typeof searchKnowledge>[2]['scopes'][number];
interface Evidence {
    citationId: string; projectId: string; qualifiedName: string; filePath: string; startLine: number;
    endLine: number; kind: string; source: string; relation: string; excerpt: string; truncated: boolean;
    unitId?: string; archiveEntry?: string; bytecode?: boolean; snapshotId?: string;
}
interface Pack { evidence: Evidence[]; usedBudgetChars: number; requestedBudgetChars: number; omittedReasons: string[] }
interface IndexJob {
    status: string; parsedFiles?: number; skippedFiles?: number; degradedFiles?: number; totalUnits?: number; totalEdges?: number; errors?: string[];
    stage?: 'scanning' | 'parsing' | 'embedding' | 'finalizing'; done?: number; total?: number; processedFiles?: number; totalFiles?: number;
}
interface ArchiveAsset {
    assetId: string; projectId: string; status: 'INDEXING' | 'READY' | 'FAILED';
    originalFileName: string; archiveType: string; error: string; indexResult: IndexJob | null;
    displayName: string; revision: number; canEdit?: boolean;
    sourceObject: { id: string; sha256: string; sizeBytes: number } | null;
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
type OperationsReport = Awaited<ReturnType<typeof diagnosticReport>>;

const zh: Record<string, string> = {
    settingsGeneral: '常规', settingsManagement: '管理', settingsModels: '模型配置', settingsProfile: '个人资料', wikiSettings: '知识库设置',
    connectTitle: '连接到工作台', connectDescription: '使用已批准的账号或本地管理员令牌登录。', token: '访问令牌', connect: '连接',
    navigation: '工作台导航', workspace: '工作空间', repositories: '仓库工作台', explore: '代码理解', search: '代码搜索',
    graph: '代码图谱', evidence: '证据包', local: '本地环境', menu: '菜单', repository: '仓库',
    light: '浅色', dark: '深色', disconnect: '断开连接', refresh: '刷新列表',
    repositoriesAbout: '管理本地代码仓库，查看索引进度与最近活动。', repositoryList: '仓库列表', indexRepository: '索引仓库',
    filterRepositoriesPlaceholder: '筛选仓库…',
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
    wikiRun: '生成步骤', wikiEmpty: '还没有 Wiki 文档。', wikiGenerated: '已生成 Wiki 摘要。',
    legacyWiki: '从旧版迁移的 Wiki 文档', LEGACY_WIKI_CITATION_UNAVAILABLE: '部分旧引用缺少安全的项目路径或有效行号。',
    wikiPartial: '已生成部分摘要，详见生成步骤。', wikiFailedRun: 'Wiki 生成失败。', wikiPending: '摘要仍在生成，可刷新此页面继续查看。',
    wikiNotes: '缺失信息',
    QUEUED: '排队中', RUNNING: '运行中', PAUSED: '已暂停', SKIPPED: '已跳过',
    WIKI_MODEL_UNAVAILABLE: '生成模型暂不可用。', WIKI_INDEX_RUNNING: '请等待当前索引任务完成。',
    WIKI_ALREADY_RUNNING: '此仓库已有 Wiki 生成任务。', WIKI_QUEUE_FULL: 'Wiki 任务队列已满。',
    WIKI_UNIT_LIMIT: '已达到符号采样上限。', WIKI_MODULE_LIMIT: '已达到模块采样上限。', WIKI_CALL_LIMIT: '已达到调用采样上限。',
    WIKI_INDEX_HAS_PENDING_FILES: '索引内有等待重试的文件。',
    wikiModelSection: '模型摘要', wikiFactCollection: '收集结构事实', wikiPersist: '保存文档', wikiStepFailed: '失败',
    'wikiPhase:overview': '项目概述', 'wikiPhase:modules': '模块划分', 'wikiPhase:entrypoints': '入口与调用链',
    'wikiPhase:build': '构建与运行', 'wikiPhase:security': '安全相关面',
    'wikiPhase:business-capabilities': '可观察能力范围', 'wikiPhase:business-workflows': '可观察流程', 'wikiPhase:business-gaps': '待核实的业务问题',
    wikiBusinessGeneration: '生成业务章节', wikiTechnicalGeneration: '生成技术章节',
    WIKI_BUSINESS_EVIDENCE_MISSING: '当前索引没有足够证据生成此业务章节。', WIKI_BUSINESS_CITATIONS_REQUIRED: '业务章节缺少可核实的源码引用。',
    WIKI_TEMPLATE_VERSION_UNSUPPORTED: '此任务保存的模板版本不可用。', WIKI_SNAPSHOT_MODEL_COVERAGE_INCOMPLETE: '候选快照的模型章节覆盖未通过校验。',
    WIKI_UNKNOWN_CITATIONS: '已省略模型提供的未知引用。', INVALID_WIKI_SECTION: '模型章节格式无效。',
    WIKI_MODEL_DEADLINE: '生成任务已达到时间上限。', WIKI_MODEL_SECTIONS_INCOMPLETE: '部分模型章节暂不可用。',
    generationProviders: '生成模型配置', providerProfile: '配置档案', providerName: '名称', providerProtocol: '协议',
    providerUrl: '服务基地址', providerModel: '模型 ID', providerKey: 'API 密钥', providerTimeout: '超时（毫秒）',
    providerTokens: '输出 token 上限', providerInputPrice: '每百万输入 token 美元价格', providerOutputPrice: '每百万输出 token 美元价格',
    providerConcurrency: '模型调用并发上限', providerReservedAsk: '为问答保留的调用数',
    providerWindow: '限定后台模型调用时段', providerWindowStart: '开始时间', providerWindowEnd: '结束时间',
    providerWindowSameTime: '开始和结束时间必须不同。',
    providerClearKey: '清除已保存密钥', providerSave: '保存配置', providerDiscover: '发现模型', providerTest: '测试已保存配置',
    providerSelect: '选用已保存配置', providerDelete: '删除配置', providerNew: '新建配置', providerSelected: '当前使用',
    providerKeySaved: '密钥已保存', providerDeleteConfirm: '删除这个模型配置？', providerModelsFound: '已获取模型列表，可选择或手动填写。',
    PROVIDER_CONNECTED: '连接与模型调用成功。', PROVIDER_CREDENTIAL_CHANGE_REQUIRED: '更改地址或协议时，请更换或清除保存的密钥。',
    PROVIDER_TIMEOUT: '模型请求超时。', PROVIDER_REDIRECT_BLOCKED: '模型端点返回了重定向。',
    PROVIDER_POOL_BUSY: '模型调用已达到并发上限。', PROVIDER_ACCESS_CHANGED: '模型凭据或使用权限已变更。',
    PROVIDER_POOL_WINDOW_CLOSED: '后台模型调用正在等待运行时段。',
    architectureReview: '架构评审', architectureReady: '已收集静态证据，正在生成评审。',
    architectureDisabled: '已收集静态事实。生成模型已停用。', architectureFailed: '已收集静态事实。模型评审生成失败。',
    architectureProblem: '问题', architectureSuggestion: '建议', architectureBenefit: '收益', architectureCost: '实施成本', architectureRisk: '风险',
    architectureEvidence: '静态证据', architectureUsage: '模型用量', architecturePriceUnknown: '费用未知',
    ARCHITECTURE_UNKNOWN_CITATIONS: '已省略模型提供的未知引用。', ARCHITECTURE_STREAM_FAILED: '架构评审连接已断开。',
    'change-review': '变更评审', changeAbout: '比较已发布快照、捕获本地变更或提交统一差异。',
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
    changeBase: '基线版本', changeTarget: '目标版本', changeDiff: '统一差异（Unified diff）', changeSubmit: '创建快照',
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
    wikiEmpty: 'No Wiki documents yet.', wikiGenerated: 'Wiki summaries generated.',
    legacyWiki: 'Wiki document migrated from the legacy instance', LEGACY_WIKI_CITATION_UNAVAILABLE: 'Some legacy references lacked usable project paths or line numbers.',
    wikiPartial: 'Some summaries are incomplete. See the generation steps.', wikiFailedRun: 'Wiki generation failed.',
    wikiPending: 'Generation is still running. Refresh this page to resume tracking.', wikiNotes: 'Missing information',
    QUEUED: 'Queued', RUNNING: 'Running', PAUSED: 'Paused', SKIPPED: 'Skipped',
    WIKI_MODEL_UNAVAILABLE: 'Generation model unavailable.', WIKI_INDEX_RUNNING: 'Wait for indexing to finish.',
    WIKI_ALREADY_RUNNING: 'A Wiki generation is already running for this repository.', WIKI_QUEUE_FULL: 'The Wiki queue is full.',
    WIKI_UNIT_LIMIT: 'Symbol sampling limit reached.', WIKI_MODULE_LIMIT: 'Module sampling limit reached.',
    WIKI_CALL_LIMIT: 'Call sampling limit reached.', WIKI_INDEX_HAS_PENDING_FILES: 'Indexed files are awaiting retry.',
    wikiModelSection: 'Model summary', wikiFactCollection: 'Collect indexed facts', wikiPersist: 'Save documents', wikiStepFailed: 'Failed',
    'wikiPhase:overview': 'Project overview', 'wikiPhase:modules': 'Module boundaries', 'wikiPhase:entrypoints': 'Entry points and calls',
    'wikiPhase:build': 'Build and runtime', 'wikiPhase:security': 'Security-relevant surfaces',
    'wikiPhase:business-capabilities': 'Observable capabilities', 'wikiPhase:business-workflows': 'Observable workflows',
    'wikiPhase:business-gaps': 'Business questions to verify', wikiBusinessGeneration: 'Generate business sections', wikiTechnicalGeneration: 'Generate technical sections',
    WIKI_BUSINESS_EVIDENCE_MISSING: 'The index lacks evidence for this business section.',
    WIKI_BUSINESS_CITATIONS_REQUIRED: 'The business section lacked a verifiable source citation.',
    WIKI_TEMPLATE_VERSION_UNSUPPORTED: 'The template version saved for this job is unavailable.',
    WIKI_SNAPSHOT_MODEL_COVERAGE_INCOMPLETE: 'Model section coverage failed validation for the candidate snapshot.',
    WIKI_UNKNOWN_CITATIONS: 'Unknown model citations were omitted.', INVALID_WIKI_SECTION: 'The model returned an invalid section.',
    WIKI_MODEL_DEADLINE: 'The generation time limit was reached.', WIKI_MODEL_SECTIONS_INCOMPLETE: 'Some model sections are unavailable.',
    providerNew: 'New profile', providerSelected: 'Selected', providerKeySaved: 'API key saved',
    providerConcurrency: 'Concurrent model calls', providerReservedAsk: 'Slots reserved for Ask',
    providerWindow: 'Schedule background model calls', providerWindowStart: 'Window opens', providerWindowEnd: 'Window closes',
    providerWindowSameTime: 'Choose different opening and closing times.',
    providerDeleteConfirm: 'Delete this model profile?', providerModelsFound: 'Models loaded. Select a result or enter a model ID.',
    PROVIDER_CONNECTED: 'Connection and generation succeeded.', PROVIDER_CREDENTIAL_CHANGE_REQUIRED: 'Replace or clear the saved API key when changing the endpoint or protocol.',
    PROVIDER_TIMEOUT: 'The model request timed out.', PROVIDER_REDIRECT_BLOCKED: 'The model endpoint returned a redirect.',
    PROVIDER_POOL_BUSY: 'The model pool is at capacity.', PROVIDER_ACCESS_CHANGED: 'The saved model credentials or access changed.',
    PROVIDER_POOL_WINDOW_CLOSED: 'Background model calls are waiting for their operating window.',
    architectureReady: 'Static evidence collected. Generating the review.',
    architectureDisabled: 'Static evidence collected. Generation is disabled.', architectureFailed: 'Static evidence collected. Model review failed.',
    architectureProblem: 'Problem', architectureSuggestion: 'Suggestion', architectureBenefit: 'Benefit', architectureCost: 'Implementation cost', architectureRisk: 'Risk',
    architectureEvidence: 'Static evidence', architectureUsage: 'Model usage', architecturePriceUnknown: 'Cost unknown',
    ARCHITECTURE_UNKNOWN_CITATIONS: 'Unknown model citations were omitted.', ARCHITECTURE_STREAM_FAILED: 'The architecture review connection ended.'
};
const messagesByCode: Record<string, string> = {
    FLOW_TARGET_UNAVAILABLE: 'FLOW_TARGET_UNAVAILABLE', AMBIGUOUS_FLOW_TARGET: 'AMBIGUOUS_FLOW_TARGET', FLOW_ANALYSIS_LIMIT: 'FLOW_ANALYSIS_LIMIT',
    EMBEDDING_DISABLED: 'vectorDisabled', EMBEDDING_UNAVAILABLE: 'vectorUnavailable',
    NO_MATCHING_EVIDENCE: 'noEvidence', CANDIDATE_LIMIT_REACHED: 'candidateLimit',
    INVALID_CREDENTIALS: 'invalidCredentials',
    WIKI_INDEX_RUNNING: 'WIKI_INDEX_RUNNING', WIKI_ALREADY_RUNNING: 'WIKI_ALREADY_RUNNING', WIKI_QUEUE_FULL: 'WIKI_QUEUE_FULL',
    PROVIDER_CREDENTIAL_CHANGE_REQUIRED: 'PROVIDER_CREDENTIAL_CHANGE_REQUIRED', PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
    PROVIDER_POOL_BUSY: 'PROVIDER_POOL_BUSY', PROVIDER_ACCESS_CHANGED: 'PROVIDER_ACCESS_CHANGED',
    PROVIDER_POOL_WINDOW_CLOSED: 'PROVIDER_POOL_WINDOW_CLOSED',
    PROVIDER_REDIRECT_BLOCKED: 'PROVIDER_REDIRECT_BLOCKED', ARCHITECTURE_STREAM_FAILED: 'ARCHITECTURE_STREAM_FAILED',
    REVIEW_STATE_CONFLICT: 'REVIEW_STATE_CONFLICT', REVIEW_REASON_REQUIRED: 'REVIEW_REASON_REQUIRED',
    SAST_TRIAGE_ALREADY_RUNNING: 'SAST_TRIAGE_ALREADY_RUNNING', SAST_TRIAGE_QUEUE_FULL: 'SAST_TRIAGE_QUEUE_FULL',
    VULNERABILITY_STATE_CONFLICT: 'VULNERABILITY_STATE_CONFLICT', INVALID_VULNERABILITY_TRANSITION: 'INVALID_VULNERABILITY_TRANSITION',
    NO_SUPPORTED_MANIFEST: 'NO_SUPPORTED_MANIFEST', DEPENDENCY_INVENTORY_UNAVAILABLE: 'DEPENDENCY_INVENTORY_UNAVAILABLE',
    INVALID_BENCHMARK_RESULTS: 'INVALID_BENCHMARK_RESULTS', CODE_SCAN_INDEX_CHANGED: 'CODE_SCAN_INDEX_CHANGED'
};
const uiLabels: Record<string, readonly [english: string, chinese: string]> = {
    workspaceName: ['Local workspace', '本地工作区'], connectRepository: ['Connect repository', '接入仓库'],
    workspaceRepositories: ['Repositories', '已接入仓库'], workspaceSources: ['Folders and archives', '本地目录与归档'],
    workspaceFiles: ['Indexed files', '已索引文件'], workspaceAcrossProjects: ['Across repositories', '按仓库统计'],
    workspaceSymbols: ['Parsed symbols', '已解析符号'], workspaceSnapshot: ['Current snapshot', '当前索引快照'],
    workspaceReadiness: ['Index readiness', '索引就绪率'], workspaceReady: ['ready', '个仓库已就绪'],
    workspaceUpdated: ['Index snapshot updated', '索引快照已更新'], workspaceNoActivity: ['No index updates yet.', '暂无索引更新。'],
    workspaceNoLanguages: ['No repository language data yet.', '暂无仓库语言数据。'],
    workspaceUnknownLanguage: ['Unknown', '未知'],
    repositoryAllSources: ['All sources', '全部来源'], repositoryLanguage: ['Language', '主要语言'],
    repositoryLanguages: ['Repository languages', '仓库语言分布'], repositoryActivity: ['Recent activity', '最近活动'],
    repositoryIndexStatus: ['Index status', '索引状态'], repositoryUpdated: ['Updated', '最近更新'],
    repositoryReady: ['Ready', '已就绪'], repositoryIndexing: ['Indexing', '索引中'],
    repositoryPartial: ['Partial', '部分索引'], repositoryIdle: ['Not indexed', '未索引'],
    repositoryStatus: ['Repository status', '仓库状态'], indexOverview: ['Index overview', '索引概览'],
    toggleTheme: ['Toggle theme', '切换主题'],
    graphDiagram: ['Relationship graph', '关系图'], graphDiagramLimit: ['The diagram shows the first 32 relationships. See the list for more results.', '图中展示前 32 条关系，其余结果可在列表中查看。'],
    graphRelationshipList: ['Relationship list', '关系列表'], graphZoomIn: ['Zoom in', '放大'],
    graphZoomOut: ['Zoom out', '缩小'], graphZoomReset: ['Reset zoom', '恢复为 100%'],
    graphNoNeighbors: ['No related symbols at this depth.', '当前深度没有关联符号。'],
    frozenKnowledgeSnapshot: ['Published snapshot', '已发布快照'],
    currentKnowledgeIndex: ['Current index', '当前索引'],
    wikiSnapshots: ['Published snapshots', '已发布快照'],
    wikiLatest: ['Latest Wiki', '最新 Wiki'],
    wikiArtifacts: ['Revision exports', '修订导出'],
    wikiExportFormat: ['Format', '格式'], wikiExportSelection: ['Content', '内容范围'],
    wikiEntirePage: ['Entire page', '整个页面'], wikiPrepareExport: ['Generate export', '生成导出文件'],
    wikiNoExports: ['No exports for this revision yet.', '此修订尚无导出文件。'],
    wikiExportReady: ['Export ready.', '导出文件已可下载。'],
    WIKI_PDF_LIMIT: ['This content exceeds the PDF export limit. Select a section or download Markdown.',
        '此内容超出 PDF 导出上限。请选择单个章节或下载 Markdown。'],
    WIKI_EXPORT_BUSY: ['Other exports are running. Retry in a moment.', '正在生成其他导出文件，请稍后重试。'],
    WIKI_PDF_FAILED: ['The PDF could not be generated. Try again.', '生成 PDF 失败，请重试。'],
    wikiManageSnapshots: ['Manage snapshots', '管理快照'],
    wikiRetiredSnapshots: ['Retired snapshots', '已退役快照'],
    wikiRetireSnapshot: ['Retire selected snapshot', '退役选中的快照'],
    wikiRestoreSnapshot: ['Restore snapshot', '恢复快照'],
    wikiPurgeSnapshot: ['Delete permanently', '永久删除'],
    wikiPurgeConfirm: ['Permanently delete this retired snapshot and its Wiki revisions?', '永久删除此快照及其 Wiki 修订？'],
    wikiOlderRetired: ['Load earlier snapshots', '加载更早的退役快照'],
    wikiNoRetired: ['No retired snapshots', '没有已退役快照'],
    wikiEligibleAt: ['Eligible for cleanup after', '达到回收保留期的时间'],
    wikiSnapshotUpdated: ['Snapshot updated.', '已更新快照状态。'],
    SNAPSHOT_RETENTION_ACTIVE: ['This snapshot is still within its retention period.', '此快照仍处于保留期内。'],
    SNAPSHOT_REFERENCED: ['Another snapshot, space, draft or conversation still references this version.', '仍有快照、空间、草案或会话引用此版本。'],
    SNAPSHOT_REVISION_CHANGED: ['The snapshot changed. Reload before trying again.', '快照状态已变化，请重新加载后重试。'],
    wikiPerspective: ['Perspective', '视角'], technical: ['Technical', '技术'], business: ['Business', '业务'],
    wikiSearchPages: ['Search Wiki pages', '搜索 Wiki 页面'], wikiSearchEmpty: ['No matching Wiki pages.', '没有匹配的 Wiki 页面。'],
    wikiRevisionHistory: ['Revision history', '修订历史'], wikiRevision: ['Revision', '修订'],
    wikiOlderRevisions: ['Load older revisions', '加载更早的修订'], wikiRestoreRevision: ['Restore this revision', '恢复此修订'],
    wikiEditPage: ['Edit page', '编辑页面'], wikiMarkdownSource: ['Markdown source', 'Markdown 源文'],
    wikiSaveRevision: ['Publish revision', '发布修订'], wikiSaveDraft: ['Save as draft', '保存为草案'],
    wikiDrafts: ['Drafts', '草案'], wikiDraftInstruction: ['Instructions for the model', '给模型的指令'],
    wikiGenerateDraft: ['Generate draft', '生成草案'], wikiCompareDraft: ['Compare draft', '比较草案'],
    wikiDraftBase: ['Base revision', '基础修订'], wikiDraftProposed: ['Proposed Markdown', '草案 Markdown'],
    wikiApplyDraft: ['Apply draft', '应用草案'], wikiDiscardDraft: ['Discard draft', '丢弃草案'],
    wikiRevisionSaved: ['Revision published.', '修订已发布。'], wikiDraftSaved: ['Draft saved.', '草案已保存。'],
    wikiDraftDiscarded: ['Draft discarded.', '草案已丢弃。'], wikiDraftChoose: ['Choose a draft', '选择草案'],
    'wikiOrigin:GENERATED': ['Generated', '生成'], 'wikiOrigin:EDIT': ['Edit', '编辑'],
    'wikiOrigin:RESTORE': ['Restore', '恢复'], 'wikiOrigin:DRAFT': ['Draft applied', '应用草案'],
    'wikiDraft:PENDING': ['Pending', '待审批'], 'wikiDraft:APPLIED': ['Applied', '已应用'],
    'wikiDraft:DISCARDED': ['Discarded', '已丢弃'], wikiEditedMarkdown: ['Edited Markdown', '编辑后的 Markdown'],
    'Observed workflow': ['Observed workflow', '观测到的工作流'],
    WIKI_REVISION_CHANGED: ['A newer revision was published. Copy your changes before switching to it.',
        '已有更新的修订。切换前请复制你当前的修改。'],
    WIKI_DRAFT_ALREADY_REVIEWED: ['This draft has already been reviewed.', '此草案已审批。'],
    WIKI_DRAFT_CONTEXT_TOO_LARGE: ['This page exceeds the model’s editing context.', '此页面超出模型可用的编辑上下文。'],
    WIKI_MARKDOWN_TOO_LARGE: ['Markdown must be no larger than 2 MiB.', 'Markdown 大小上限为 2 MiB。'],
    WIKI_PENDING_DRAFT_LIMIT: ['Review pending drafts before creating more.', '请先审批现有草案。'],
    GENERATION_DISABLED: ['Model generation is disabled.', '模型生成已停用。'],
    wikiSchedule: ['Schedule generation', '预约生成'], wikiStartTime: ['Start time', '开始时间'],
    wikiRebuild: ['Rebuild Wiki', '全量重建 Wiki'],
    wikiPause: ['Pause', '暂停'], wikiResume: ['Resume', '继续'], wikiCancel: ['Cancel generation', '取消生成'],
    wikiScheduledFor: ['Scheduled for', '预约开始时间'], wikiStopping: ['Stopping generation…', '正在停止生成…'],
    JOB_CHANGED_OR_ACTION_UNAVAILABLE: ['This job changed. Review its current state and try again.', '任务状态已变化，请查看当前状态后重试。'],
    knowledgeSearch: ['Knowledge', '知识检索'], knowledgeScopeHelp: ['Select up to eight repositories or spaces.', '最多可选择八个仓库或空间。'],
    knowledgeCoverage: ['Search coverage', '检索覆盖'], knowledgeScopeRequired: ['Choose a repository or space.', '请选择仓库或空间。'],
    knowledgeExactScope: ['Search this version', '检索此版本'], knowledgeChooseScope: ['Choose sources', '选择来源'],
    knowledgePartial: ['Some sources could not be searched.', '部分来源未能完成检索。'],
    knowledgeExcerpt: ['Excerpt', '节选'], knowledgeBinary: ['Binary signature', '二进制签名'],
    'knowledge:SOURCE': ['Code', '源码'], 'knowledge:WIKI': ['Wiki', 'Wiki'], 'knowledge:DOCUMENT': ['Markdown', 'Markdown'],
    'knowledge:SPACE': ['Space', '空间'], 'knowledge:MATCHED': ['Matched', '有命中'], 'knowledge:NO_MATCHES': ['No matches', '无命中'],
    'knowledge:INDEX_UNAVAILABLE': ['Index unavailable', '缺少可用索引'], 'knowledge:QUERY_FAILED': ['Query failed', '查询失败'],
    KNOWLEDGE_SEARCH_UNAVAILABLE: ['None of the selected sources could be searched.', '所选来源均未能完成检索。'],
    KNOWLEDGE_SCOPE_TOO_LARGE: ['Choose fewer sources. A search covers up to eight repository snapshots and 24 document versions.',
        '请缩小范围。每次最多检索八个仓库快照和 24 个文档版本。'],
    JOB_REQUEST_CONFLICT: ['This request key is already in use for a different job.', '此请求标识已用于其他任务。'],
    WIKI_JOB_BUDGET_EXHAUSTED: ['The generation time or recovery limit was reached.', '生成时间或恢复次数已达上限。'],
    operationsDiagnostics: ['Service diagnostics', '服务诊断'], operationsLookupType: ['Diagnose by', '查询类型'],
    operationsRequestId: ['Request ID', '请求 ID'], operationsRunId: ['Run ID', '运行 ID'], operationsIdentifier: ['Identifier', '标识'],
    operationsComponent: ['Component', '组件'], operationsQueue: ['Durable queues', '持久队列'], operationsLeases: ['Expired leases', '过期租约'],
    operationsReadyAge: ['Oldest ready (s)', '最久待执行（秒）'], operationsResponses: ['HTTP responses', 'HTTP 响应'],
    'ops:database': ['Database', '数据库'], 'ops:managedFiles': ['Managed files', '受管文件'], 'ops:fullText': ['Full text search', '全文索引'],
    'ops:vectorSearch': ['Vector search', '向量检索'], 'ops:generation': ['Model generation', '模型生成'],
    'ops:metrics': ['Metrics persistence', '指标持久化'],
    'ops:wiki': ['Wiki worker', 'Wiki 执行器'], 'ops:gitSync': ['Git sync worker', 'Git 同步执行器'], 'ops:ask': ['Ask worker', '问答执行器'],
    'ops:isolatedVerification': ['Isolated verification worker', '隔离验证执行器'],
    'ops:ok': ['Operational', '运行正常'], 'ops:degraded': ['Degraded', '部分能力降级'],
    'ops:available': ['Available', '可用'], 'ops:unavailable': ['Unavailable', '不可用'],
    'ops:unverified': ['Awaiting a model call', '尚无近期模型调用'], 'ops:read-only': ['Read only', '只读'],
    'ops:disabled': ['Disabled', '已停用'], 'ops:stopped': ['Stopped', '已停止'],
    'ops:starting': ['Starting', '启动中'], 'ops:stale': ['Heartbeat stale', '心跳超时'],
    DIAGNOSTIC_REQUEST_NOT_FOUND: ['This request is outside the recent history.', '近期记录中没有此请求。'],
    DIAGNOSTIC_RUN_NOT_FOUND: ['The repository run was not found.', '找不到此仓库运行。'],
    changeInput: ['Review input', '评审输入'], changePublished: ['Published snapshots', '已发布快照'],
    changeBaseSnapshot: ['Baseline snapshot', '基线快照'], changeTargetSnapshot: ['Target snapshot', '目标快照'],
    changeUsePrevious: ['Use previous verified review', '沿用上次已验证评审'],
    changeFullSnapshot: ['Review the full target', '评审完整目标版本'], changeVersionsEmpty: ['Publish a snapshot first.', '请先发布仓库快照。'],
    changeComparedFiles: ['Compared files', '比较文件'], changeOpenVersion: ['Open source in this snapshot', '在此快照中打开源码'],
    changeWorkingCopy: ['Local working copy', '本地工作副本'], changeOpenOverlaySource: ['Open captured source', '打开捕获的源码'],
    changeWorkingPaths: ['Repository-relative file paths, one per line (up to 24)', '仓库内的相对文件路径，每行一条，最多 24 条'],
    changeWorkingPathsInvalid: ['Enter 1 to 24 distinct file paths.', '请输入 1 到 24 条互不重复的文件路径。'],
    OVERLAY_GRAPH_UNAVAILABLE: ['The working-copy capture has no graph index.', '工作副本捕获没有代码图索引。'],
    changeCheck: ['Check', '检查'], changeCheckCoverage: ['Check coverage', '检查覆盖'], changeCheckSource: ['Source of result', '结果来源'],
    'change-check:ZERO_FINDINGS': ['No findings', '零发现'], 'change-check:NOT_APPLICABLE': ['Not applicable', '未适用'],
    'change-check:UNAVAILABLE': ['Unavailable', '不可用'], 'change-check:COMPLETED': ['Completed', '已完成'],
    'change-check:FAILED': ['Failed', '执行失败'], 'change-check:PARTIAL': ['Partial', '部分完成'],
    'change-check:DECLARED_VERSION': ['Declared version', '报告声明的版本'], 'change-check:UNRECORDED': ['No receipt', '无检查回执'],
    'change-check:FROZEN_INDEX_INPUT': ['Frozen inputs', '冻结输入'],
    'change-check:VERIFIED_ARCHIVE_SOURCE': ['Verified archive source', '已核验归档源码'],
    changeDependencyCheck: ['Offline dependency check', '离线依赖检查'],
    changeDependencyManifestDigest: ['Manifest digest', '清单摘要'],
    changeDependencyCatalogDigest: ['Advisory catalog digest', '公告目录摘要'],
    WIKI_DOCX_LIMIT: ['Select a smaller section to export to Word.', '请选择更小的章节导出为 Word。'],
    askChangeReview: ['Ask about this review', '追问这份评审'],
    askChangeFinding: ['Ask about this finding', '追问这项发现'],
    askFrozenReview: ['Frozen change report', '固定变更评审'],
    EXTERNAL_CHECKS_INCOMPLETE: ['One or more external checks did not finish cleanly.', '部分外部检查未完整完成。'],
    REVIEW_FINDINGS_TRUNCATED: ['This report reached the finding limit.', '此报告已达到发现数量上限。'],
    changeDisposition: ['Disposition', '处置'], changeReasonForDecision: ['Reason', '处置理由'],
    changeRecordDecision: ['Save disposition', '保存处置'], changeReloadDecisions: ['Reload dispositions', '重新加载处置'],
    'change-finding:CHANGED_LINE': ['Changed line', '变更行'], 'change-finding:REPORT_ONLY': ['Report only', '仅列入报告'],
    'change-finding:UNREVIEWED': ['Unreviewed', '待审核'],
    'change-finding:CONFIRM': ['Confirm', '确认'], 'change-finding:DISMISS': ['Dismiss', '驳回'],
    'change-finding:REQUEST_REVIEW': ['Request review', '请求复核'], 'change-finding:APPEAL': ['Appeal', '申诉'],
    CHANGE_REVIEW_FINDING_CHANGED: ['The disposition changed. Reload it before saving.', '处置记录已更新，请重新加载后保存。'],
    CHANGE_REVIEW_APPEAL_UNAVAILABLE: ['Appeal requires a confirmed or dismissed disposition.', '只有已确认或已驳回的发现可以申诉。'],
    CHANGE_REVIEW_REQUEST_CONFLICT: ['Another request already used this key.', '此请求标识已用于另一份请求。'],
    'change:EXPLICIT': ['Selected baseline', '指定基线'], 'change:PREVIOUS_REVIEW': ['Previous verified review', '上次已验证评审'],
    'change:FULL_REQUESTED': ['Full target comparison', '完整比较目标版本'],
    'change:NO_PREVIOUS_REVIEW': ['Full comparison because there was no verified baseline', '无已验证基线，比较完整版本'],
    'change:PREVIOUS_BASELINE_UNAVAILABLE': ['Full comparison because the previous baseline is unavailable', '上次基线不可读，比较完整版本'],
    DIFF_COMPARISON_BUDGET: ['Comparison exceeded its available budget.', '已达到比较预算。'],
    DIFF_SOURCE_UNAVAILABLE: ['The published source is unavailable.', '已发布源码不可读取。'],
    DIFF_FILE_BYTE_LIMIT: ['The file exceeds the comparison size limit.', '文件超过比较大小上限。'],
    operationsInvalidId: ['Enter a valid request or run ID.', '请输入有效的请求或运行 ID。'],
    allFilter: ['All', '全部'], openAiCompatible: ['OpenAI compatible', '兼容 OpenAI'],
    repositoryType: ['Repository source', '仓库来源'], repositoryLocal: ['Local folders', '本地目录'],
    repositoryArchives: ['Archives', '源码归档'], repositoryLocalCard: ['Local folder', '本地目录'],
    filterRepositories: ['Filter repositories', '筛选仓库'], repositoryFilterEmpty: ['No repositories match these filters.', '没有符合筛选条件的仓库。'],
    repositoryActions: ['Repository actions', '仓库操作'],
    projectTrash: ['Repository trash', '仓库回收站'], projectTrashMove: ['Move to trash', '移入回收站'],
    projectTrashConfirm: ['Move this repository to trash?', '将此仓库移入回收站？'],
    projectPurgeConfirm: ['Permanently delete this repository’s indexed data and managed copies?', '永久清理此仓库的索引和托管副本？'],
    projectTrashMoved: ['Repository moved to trash.', '仓库已移入回收站。'], projectTrashRestored: ['Repository restored.', '仓库已恢复。'],
    projectPurging: ['Cleaning up managed files', '正在清理托管文件'], projectPurged: ['Repository data removed.', '仓库数据已清理。'],
    projectRetentionUntil: ['Retained until', '保留至'],
    PROJECT_WORK_PENDING: ['Repository tasks are still pending.', '仓库仍有未结束的任务。'],
    PROJECT_STILL_REFERENCED: ['Other resources still reference this repository.', '其他资源仍引用此仓库。'],
    PROJECT_RETENTION_ACTIVE: ['The retention period is still active.', '仓库仍在回收保留期。'],
    PROJECT_LIFECYCLE_CHANGED: ['This repository changed. Refresh its state and try again.', '仓库回收状态已变化，请刷新后再试。'],
    PROJECT_LIFECYCLE_STATE: ['This action is unavailable in the current repository state.', '仓库当前状态无法执行此操作。'],
    securityNav: ['Security and review', '安全与评审'], systemNav: ['System', '系统'],
    collapseNavigation: ['Collapse sidebar', '收起侧栏'], expandNavigation: ['Expand sidebar', '展开侧栏'],
    readerToolbar: ['Document toolbar', '文稿工具栏'], readerToggleOutline: ['Toggle outline', '切换目录'],
    readerPrevious: ['Previous section', '上一节'], readerNext: ['Next section', '下一节'],
    readerSearch: ['Search document', '搜索文稿'], readerSearchPlaceholder: ['Find a section or source reference…', '搜索章节或源码引用…'],
    readerDocument: ['Document', '文稿'], readerOutline: ['Outline', '目录'], readerSources: ['References', '引用'],
    readerMode: ['Reading view', '阅读视图'], readerActions: ['Document actions', '文稿操作'],
    readerResults: ['Document search results', '文稿搜索结果'], readerSections: ['Sections', '章节'],
    readerNavigate: ['Navigate', '选择'], readerOpen: ['Open', '打开'], readerCopy: ['Copy', '复制'],
    readerLargerText: ['Larger reading text', '放大阅读字号'], readerCopyLink: ['Copy link', '复制链接'],
    readerCopied: ['Link copied.', '链接已复制。'], readerCopyFailed: ['Copy the link from the address bar.', '请从地址栏复制链接。'],
    readerNoSources: ['This document has no references.', '本文档暂无引用。'],
    readerNoExcerpt: ['No matching excerpt in the current index.', '当前索引没有匹配的源码片段。'],
    readerExcerptFailed: ['Could not load the source excerpt.', '无法加载源码片段。'],
    readerExcerpt: ['Indexed source excerpt', '索引中的源码片段'], readerShowSource: ['Show reference', '查看引用'],
    readerWikiIntroduction: ['Indexed modules, entry points, and source references.', '查看已索引的模块、入口及其源码引用。'],
    wikiFactOverview: ['Overview', '概览'], wikiFactModules: ['Modules', '模块'],
    wikiFactEntrypoints: ['Entry points and direct calls', '入口点与直接调用'], wikiFactHotspots: ['Complexity hotspots', '复杂度热点'],
    wikiFactModule: ['Module facts', '模块概况'], wikiFactDependencies: ['Cross-module dependencies', '跨模块依赖'],
    wikiFactSymbols: ['Key symbols', '关键符号'],
    architectureObservations: ['Observations', '观察结果'],
    CLASS: ['Class', '类'], INTERFACE: ['Interface', '接口'], ENUM: ['Enum', '枚举'], ANNOTATION: ['Annotation', '注解'],
    METHOD: ['Method', '方法'], CONSTRUCTOR: ['Constructor', '构造函数'], FIELD: ['Field', '字段'], LOCAL_VAR: ['Local variable', '局部变量'],
    STRUCT: ['Struct', '结构体'], UNION: ['Union', '联合体'], TYPEDEF: ['Type alias', '类型别名'], MACRO: ['Macro', '宏'],
    FUNCTION: ['Function', '函数'], DOCUMENT: ['Document', '文档'],
    CALLS: ['Calls', '调用'], CONTAINS: ['Contains', '包含'], IMPORTS: ['Imports', '导入'], EXTENDS: ['Extends', '继承'],
    IMPLEMENTS: ['Implements', '实现'], DEFINES_TYPE: ['Defines type', '定义类型'], OVERRIDES: ['Overrides', '重写'],
    typescript: ['TypeScript', 'TypeScript'], javascript: ['JavaScript', 'JavaScript'], java: ['Java', 'Java'],
    python: ['Python', 'Python'], c: ['C', 'C'], cpp: ['C++', 'C++'], doc: ['Markdown', 'Markdown'],
    VECTOR: ['Vector search', '向量检索'], KEYWORD: ['Keyword search', '关键词检索'], CALL_GRAPH: ['Call graph', '调用图谱'],
    SEED: ['Initial match', '初始匹配'], CALLER: ['Caller', '调用方'], CALLEE: ['Callee', '被调用方'], IMPACT: ['Impact', '变更影响'],
    CHANGE: ['Change', '变更'], FINDING: ['Finding', '报警'],
    CRITICAL: ['Critical', '严重'], HIGH: ['High', '高危'], MEDIUM: ['Medium', '中危'], LOW: ['Low', '低危'], INFO: ['Informational', '提示'],
    SOURCE: ['Source', '来源'], PROPAGATION: ['Propagation', '传播'], SINK: ['Sink', '终点'],
    CALL: ['Call', '调用'], FLOW: ['Flow', '流转'], NOTE: ['Note', '备注'], PROTECTION: ['Protection', '防护'],
    ACCESS_DENIED: ['You do not have access to this resource.', '你没有权限访问此资源。'],
    RATE_LIMITED: ['Too many attempts. Try again later.', '尝试次数过多，请稍后重试。'],
    INVALID_REQUEST: ['Check the submitted fields and try again.', '请检查填写内容后重试。'],
    INVALID_CSRF_TOKEN: ['Refresh the page and try again.', '请刷新页面后重试。'],
    ACCOUNT_EXISTS: ['This username is already registered.', '该用户名已注册。'],
    INVALID_USERNAME: ['Enter a valid username.', '请输入有效的用户名。'],
    INVALID_PASSWORD_LENGTH: ['Use at least 12 characters and at most 72 UTF-8 bytes.', '密码至少需要 12 个字符，且不超过 72 个 UTF-8 字节。'],
    INVALID_ACCOUNT_TRANSITION: ['The account state has changed. Refresh the list.', '账号状态已变更，请刷新列表。'],
    ORGANIZATION_EXISTS: ['An organization already uses this name.', '已有组织使用该名称。'],
    MEMBERSHIP_REQUIRES_ACTIVE: ['Select an active account and organization.', '请选择已启用的账号和组织。'],
    OWNER_MUST_BE_ACTIVE: ['Select an active account or organization.', '请选择已启用的账号或组织。'],
    ACCOUNT_REGISTERED: ['Account registered', '账号已注册'], ACCOUNT_ACTIVE: ['Account approved', '账号已批准'],
    ACCOUNT_REJECTED: ['Account rejected', '账号申请已驳回'], ACCOUNT_DISABLED: ['Account disabled', '账号已停用'],
    ORGANIZATION_CREATED: ['Organization created', '已创建组织'], ORGANIZATION_UPDATED: ['Organization updated', '已更新组织'],
    MEMBERSHIP_ADDED: ['Member added', '已添加成员'], MEMBERSHIP_REMOVED: ['Member removed', '已移除成员'],
    PROJECT_ASSIGNED: ['Repository assigned', '已分配仓库'],
    PROJECT_NOT_FOUND: ['This repository is unavailable.', '该仓库不可用。'],
    ABSOLUTE_PROJECT_ROOT_REQUIRED: ['Enter the repository’s absolute path.', '请输入仓库的绝对路径。'],
    PROJECT_ROOT_UNAVAILABLE: ['The repository directory is unavailable.', '仓库目录不可用。'],
    PROJECT_ROOT_NOT_DIRECTORY: ['Select a repository directory.', '请选择仓库目录。'],
    PROJECT_ROOT_OUTSIDE_ALLOWED_DIRECTORY: ['Use a directory inside the configured workspace root.', '请使用配置的工作区根目录下的目录。'],
    INDEX_ALREADY_RUNNING: ['This repository is already being indexed.', '此仓库正在索引。'],
    INDEX_CAPACITY_EXHAUSTED: ['The indexer is busy. Try again later.', '索引服务繁忙，请稍后重试。'],
    SYNTAX_ERROR: ['Syntax error', '语法错误'], PARSE_TIMEOUT: ['Parsing timed out', '解析超时'],
    FILE_CHECK_FAILED: ['Could not check the file', '无法检查文件'], FILE_LIMIT_EXCEEDED: ['File limit exceeded', '超过文件数量上限'],
    INDEX_CANCELLED: ['Indexing was cancelled.', '索引已取消。'], PROJECT_INDEX_FAILED: ['Repository indexing failed.', '仓库索引失败。'],
    SOURCE_FILE_NOT_FOUND: ['The source file could not be found.', '找不到源文件。'],
    AMBIGUOUS_GRAPH_TARGET: ['Multiple symbols share this name. Use a symbol ID.', '存在多个同名符号，请使用符号 ID。'],
    AMBIGUOUS_RESULT_USE_PROJECT_ID: ['Multiple repositories matched. Select a repository.', '有多个仓库匹配，请选择一个仓库。'],
    ARCHIVE_EMPTY: ['The archive is empty.', '归档为空。'], ARCHIVE_FILE_REQUIRED: ['Choose a source archive.', '请选择源码归档。'],
    UNSUPPORTED_ARCHIVE_TYPE: ['This archive format is not supported.', '不支持此归档格式。'],
    INVALID_ARCHIVE: ['The source archive could not be read.', '无法读取源码归档。'],
    UNSAFE_ARCHIVE_ENTRY: ['The archive contains an invalid entry.', '归档包含无效条目。'],
    BODY_TOO_LARGE: ['The upload exceeds the size limit.', '上传内容超过大小限制。'],
    INVALID_INPUT: ['Check the submitted fields and try again.', '请检查填写内容后重试。'],
    ASSET_INDEXING: ['This archive is still being indexed.', '此归档仍在索引。'],
    ASSET_NOT_READY: ['Wait for archive indexing to finish.', '请等待归档索引完成。'],
    ASSET_SOURCE_UNAVAILABLE: ['The archived source is unavailable.', '归档源码不可用。'],
    CODEQL_DATABASE_FAILED: ['CodeQL could not build its analysis database.', 'CodeQL 无法创建分析数据库。'],
    CODEQL_ANALYSIS_FAILED: ['CodeQL analysis failed.', 'CodeQL 分析失败。'],
    INVALID_SCANNER_REPORT: ['The scanner returned an invalid report.', '扫描工具返回的报告格式无效。'],
    SCANNER_OUTPUT_LIMIT: ['The scanner report exceeded the size limit.', '扫描报告超过大小限制。'],
    CONTEXT_REFERENCE_LIMIT: ['Evidence reference limit reached.', '已达到证据引用上限。'],
    CONTEXT_BUDGET_LIMIT: ['The evidence pack reached its character budget.', '证据包已达到字符预算。'],
    NO_CONTEXT_EVIDENCE: ['No context evidence was found.', '未找到上下文证据。'],
    'empty rawSource': ['Source is unavailable.', '源码不可用。'],
    'budget exhausted': ['The character budget was exhausted.', '字符预算已用尽。'],
    'excerpt truncated by budget': ['The excerpt was shortened to fit the budget.', '源码片段已按预算截断。'],
    BINARY_CHANGE_NOT_REVIEWED: ['Binary changes were omitted.', '已省略二进制文件变更。'],
    HUNK_EXCEEDS_BUDGET: ['The diff hunk exceeds the review budget.', '该差异块超过评审预算。'],
    REMOVED_OR_CONTEXT_ONLY_LINES: ['This hunk has only removed lines or context.', '该差异块只有删除行或上下文。'],
    CHANGED_LINE_NOT_INDEXED: ['The changed line is absent from the index.', '索引中没有该变更行。'],
    INVALID_DIFF_PATH: ['The diff contains an invalid repository path.', '差异中包含无效的仓库路径。'],
    INVALID_DIFF_HUNK: ['The diff contains an invalid hunk.', '差异中包含无效的差异块。'],
    UNSUPPORTED_COMBINED_DIFF: ['Combined diffs are unsupported.', '不支持合并差异。'],
    DIFF_FILE_LIMIT: ['The diff exceeds the file limit.', '差异中的文件数量超过上限。'],
    DIFF_HUNK_LIMIT: ['The diff exceeds the hunk limit.', '差异块数量超过上限。'],
    FILE_PARSE_INCOMPLETE: ['The file change could not be parsed completely.', '未能完整解析该文件的变更。'],
    NO_TEXT_HUNKS: ['There are no text changes to review.', '没有可评审的文本变更。'],
    MAX_UNITS_REACHED: ['The review reached its unit limit.', '已达到评审单元上限。'],
    BUDGET_CLAMPED: ['The character budget was reduced to the supported limit.', '字符预算已降低至支持的上限。'],
    BASE_VERSION_UNKNOWN: ['The base version is unknown.', '基线版本未知。'], TARGET_VERSION_UNKNOWN: ['The target version is unknown.', '目标版本未知。'],
    INDEX_LOOKUP_LIMIT: ['The index lookup limit was reached.', '已达到索引查询上限。'],
    EXTERNAL_FINDING_REFERENCE_LIMIT: ['The external finding reference limit was reached.', '已达到外部报警引用上限。'],
    VULNERABILITY_REFERENCE_LIMIT: ['The vulnerability reference limit was reached.', '已达到漏洞引用上限。'],
    PARSE_FAILED: ['Parsing failed.', '解析失败。'], MODULE_UNAVAILABLE: ['The module is unavailable.', '模块不可用。'],
    POM_LIMIT: ['The Maven POM limit was reached.', '已达到 Maven POM 数量上限。'],
    PARENT_DEPTH_LIMIT: ['The parent manifest depth limit was reached.', '已达到父清单层数上限。'],
    DEPENDENCY_LIMIT: ['The dependency limit was reached.', '已达到依赖数量上限。'],
    SUBPROJECT_LIMIT: ['The subproject limit was reached.', '已达到子项目数量上限。'],
    DECLARATION_LIMIT: ['The dependency declaration limit was reached.', '已达到依赖声明数量上限。']
};
const views: View[] = ['repositories', 'spaces', 'overview', 'search', 'graph', 'evidence', 'ask', 'wiki', 'findings', 'review-queue', 'vulnerabilities',
    'scan-history', 'triage-agent', 'change-review', 'benchmark', 'admin'];
const originals = new Map<Element, string>();
const staticEnglish = new Map<string, string>();
const liveMessages = new WeakMap<HTMLElement, () => string>();
const askLabels: Record<string, [string, string]> = {
    ask: ['Ask', '问答'], askHistory: ['Conversations', '会话'], askSessionTitle: ['Conversation name', '会话名称'],
    askCreate: ['Start conversation', '开启会话'], askQuestion: ['Question', '问题'], askSubmit: ['Send question', '发送问题'],
    askAttachments: ['Private attachments', '私有附件'], askAttachmentPreview: ['Attachment preview', '附件预览'],
    askAttachmentLimits: ['PDF, Markdown or plain text. Up to 8 files, 256 KiB each and 1 MiB total.',
        '支持 PDF、Markdown 或纯文本。最多 8 个文件，每个不超过 256 KiB，总计不超过 1 MiB。'],
    askAttachmentDownload: ['Download original', '下载原文'], askAttachmentRemove: ['Remove', '移除'],
    askAttachmentRestore: ['Restore', '恢复'], askAttachmentRemoved: ['Removed', '已移除'],
    askAttachmentAffected: ['Restore the removed attachment to reopen this conversation.', '恢复已移除的附件后可以重新打开会话。'],
    askAttachmentLines: ['Lines', '行号'], askAttachmentClipped: ['Preview shortened', '预览已截断'],
    ASK_ATTACHMENT_CAPACITY_EXCEEDED: ['The selected files exceed the attachment limits.', '所选文件超出附件大小或数量限制。'],
    ASK_ATTACHMENT_INVALID_TEXT: ['An attachment is not valid UTF-8 text.', '有附件不是有效的 UTF-8 文本。'],
    ASK_ATTACHMENT_NAME_CONFLICT: ['Choose distinct attachment names.', '请选择名称不同的附件。'],
    ASK_ATTACHMENT_REVISION_CHANGED: ['The attachment changed. Reopen the conversation to refresh it.', '附件状态已变化，请重新打开会话。'],
    askCancel: ['Cancel question', '取消提问'], askFromWiki: ['Ask about this snapshot', '就此快照提问'],
    askNew: ['New conversation', '新会话'], askSelectScope: ['Select a repository, project space, or attachment.', '请选择仓库、项目空间或附件。'],
    askEvidence: ['Evidence', '证据'], askAnswer: ['Answer', '回答'], askFrozenSnapshot: ['Selected snapshot', '选定快照'],
    askCarriedEvidence: ['From the previous answer', '沿用上一条回答的引用'],
    askPartialSpaces: ['Skip inaccessible spaces', '跳过无权访问的空间'], askRetention: ['Keep conversation for days', '会话保留天数'],
    ASK_PUBLISHED_SNAPSHOT_REQUIRED: ['Publish a repository snapshot before starting a conversation.', '请先发布仓库快照再开启会话。'],
    ASK_SCOPE_ACCESS_CHANGED: ['Access to this conversation has changed.', '此会话的访问权限已变更。'],
    ASK_NO_EVIDENCE: ['No matching evidence was found.', '没有找到匹配的证据。'],
    ASK_SCOPE_INCOMPLETE: ['Some sources were unavailable.', '部分来源当前不可用。'],
    ASK_MODEL_OUTCOME_UNKNOWN: ['The model request was interrupted before its outcome could be verified.', '模型请求中断，结果无法确认。'],
    GENERATION_DISABLED: ['Model generation is disabled. Retrieved evidence is available.', '模型生成未启用，可查看已检索证据。'],
    TIMED_OUT: ['Timed out', '超时']
};
const deviceLabels: Record<string, [string, string]> = {
    deviceAuthorization: ['Device access', '设备授权'], deviceCode: ['Code shown by the CLI', 'CLI 显示的授权码'],
    deviceReview: ['Review request', '查看请求'], deviceApprove: ['Approve device', '授权设备'], deviceDeny: ['Deny', '拒绝'],
    deviceReadScope: ['This device can read knowledge you can access. Approve only a code you requested.', '此设备可读取你有权查看的知识。请核对授权码来自你发起的请求。'],
    deviceActive: ['Authorized devices', '已授权设备'], deviceRevoke: ['Revoke access', '撤销授权'], deviceRefresh: ['Refresh', '刷新'],
    deviceNone: ['No active device credentials', '暂无有效设备凭据'],
    deviceApproved: ['Device approved. Return to the CLI.', '设备已授权，请返回 CLI。'], deviceDenied: ['Device denied.', '已拒绝设备授权。'],
    deviceRevoked: ['Device access revoked.', '设备授权已撤销。'],
    DEVICE_CODE_UNAVAILABLE: ['The code is invalid, expired or already used.', '授权码无效、已过期或已使用。'],
    DEVICE_AUTH_DISABLED: ['Device access is disabled for this workspace.', '此工作区未启用设备授权。']
};

const spaceLabels: Record<string, [string, string]> = {
    spaces: ['Project spaces', '项目空间'], spaceName: ['Space name', '空间名称'], spaceCreate: ['Create space', '创建空间'],
    spaceRepositories: ['Linked repositories', '已关联仓库'], spaceLink: ['Link repository', '关联仓库'],
    spaceDocuments: ['Shared documents', '共享文档'], spaceUp: ['Root folder', '根目录'], spaceSearch: ['Search documents', '搜索文档'],
    spaceSearchSubmit: ['Search', '搜索'], spaceClear: ['Clear', '清除'],
    spaceItemName: ['Folder or document name', '文件夹或文档名称'], spaceNewFolder: ['New folder', '新建文件夹'],
    spaceNewDocument: ['New Markdown', '新建 Markdown'], spaceTrash: ['Trash', '回收站'], spaceVersion: ['Revision', '修订版本'],
    spaceMarkdown: ['Markdown source', 'Markdown 源文'], spaceSave: ['Save revision', '保存修订'],
    spacePdfPage: ['Page', '页码'], spacePdfText: ['Extracted page text', '提取的页面文字'],
    spacePdfNoText: ['This page has no extractable text. Download the PDF to view the original page.', '此页没有可提取文字，可下载 PDF 查看原页。'],
    spacePdfTruncated: ['The extracted text was truncated. The original PDF contains the complete page.', '提取的文字已截断，完整内容见原始 PDF。'],
    spaceDownloadPdf: ['Download original PDF', '下载原始 PDF'],
    spaceDownloadCsv: ['Download CSV', '下载 CSV'], spaceCsvTable: ['CSV table', 'CSV 表格'],
    spaceCsvPrevious: ['Previous rows', '上一组行'], spaceCsvNext: ['Next rows', '下一组行'],
    spaceCsvRow: ['Row', '行'], spaceCsvColumn: ['Column', '列'], spaceCsvEmpty: ['This CSV file has no cells.', '此 CSV 文件没有单元格。'],
    CSV_INVALID_ENCODING: ['CSV files use UTF-8 encoding.', 'CSV 文件须使用 UTF-8 编码。'],
    CSV_INVALID: ['The CSV file contains an invalid field or quote.', 'CSV 文件包含无效字段或引号。'],
    CSV_GRID_TOO_LARGE: ['The CSV grid exceeds the supported row, column or cell count.', 'CSV 超过支持的行数、列数或单元格数。'],
    CSV_CELL_NOT_FOUND: ['The cell is unavailable in this revision.', '此修订中找不到该单元格。'],
    ASK_CONTEXT_CELL_OUT_OF_RANGE: ['The cell is outside the selected CSV revision.', '该单元格不在所选 CSV 修订中。'],
    spaceGenerateDocument: ['Generate Markdown', '生成 Markdown'], spaceGenerateRevision: ['Generate a revision', '生成修订'],
    spaceGenerationInstruction: ['Instructions', '生成指令'], spaceGenerateSave: ['Generate and save', '生成并保存'],
    spaceGenerationConsent: ['Generation sends these instructions and the saved revision, if any, to the configured model.',
        '生成会将指令及已有的已保存正文发送给配置的模型。'],
    SPACE_GENERATION_IN_PROGRESS: ['This request is still running. Check again with the same instructions.', '该请求仍在运行，请使用相同指令再次查询。'],
    SPACE_GENERATION_UNCONFIRMED: ['The previous generation outcome is unconfirmed. Inspect the document before making a new request.',
        '上次生成的结果无法确认。请先检查文档，再发起新请求。'],
    SPACE_GENERATION_CONTEXT_TOO_LARGE: ['The saved revision exceeds the generation context limit of 48,000 bytes.', '已保存的修订超过 48,000 字节的生成上下文上限。'],
    SPACE_GENERATION_EMPTY: ['The model returned an empty document.', '模型返回了空文档。'],
    spaceRestore: ['Restore', '恢复'], spaceRestoreName: ['Restore as', '恢复为'],
    spaceRestoreVersion: ['Restore this revision', '恢复此版本'], spaceUnlink: ['Unlink', '解除关联'],
    spaceLatest: ['Open latest revision', '打开最新修订'], spaceRetainedDraft: ['Retained draft', '保留的草稿'],
    spaceArchive: ['Archive space', '归档空间'], spaceReactivate: ['Reactivate space', '重新启用空间'],
    spaceArchived: ['Archived', '已归档'], spaceSaved: ['Revision saved', '修订已保存'],
    spaceEmpty: ['No items', '暂无内容'], spaceDelete: ['Move to trash', '移入回收站'],
    spaceMove: ['Move or rename', '移动或重命名'], spaceDestination: ['Destination', '目标位置'],
    spaceKeepFolder: ['Keep current folder', '保留当前目录'], spaceParentFolder: ['Parent folder', '上一级目录'],
    spaceFolderEmpty: ['No subfolders', '没有子目录'], spacePurge: ['Delete permanently', '永久删除'],
    spacePurgeConfirm: ['Permanently delete this item and its versions?', '永久删除此项及其所有版本？'],
    spaceSettings: ['Space settings', '空间设置'], spaceSaveSettings: ['Save settings', '保存设置'],
    spaceReloadSettings: ['Reload settings', '重新加载设置'], spaceSettingsSaved: ['Space settings saved.', '空间设置已保存。'],
    spaceMaxRepositories: ['Repository limit', '关联仓库上限'], spaceMaxFileBytes: ['Single file limit (bytes)', '单文件上限（字节）'],
    spaceMaxBytes: ['Total storage limit (bytes)', '总容量上限（字节）'], spaceUsage: ['Storage used (bytes)', '已占用（字节）'],
    spaceMembers: ['Space members', '空间成员'], spaceRole: ['Role', '角色'], spaceGrantRole: ['Grant access', '授予访问权限'],
    spaceSaveRole: ['Save role', '保存角色'], spaceRevokeRole: ['Remove access', '移除访问权限'],
    spaceTransfer: ['Make owner', '设为所有者'], spaceTransferConfirm: ['Transfer ownership to this member?', '将空间所有权移交给此成员？'],
    'spaceRole:OWNER': ['Owner', '所有者'], 'spaceRole:ADMIN': ['Admin', '管理员'],
    'spaceRole:EDITOR': ['Editor', '编辑者'], 'spaceRole:VIEWER': ['Viewer', '查看者'],
    spaceDeleteSpace: ['Delete space', '删除空间'], spaceDeleteConfirm: ['Delete this space? It can be restored from Deleted spaces.', '删除此空间？之后可从「已删除空间」恢复。'],
    spaceDeleted: ['Deleted spaces', '已删除空间'], ACCOUNT_MUST_BE_ACTIVE: ['Enter an active account.', '请输入有效的活跃账号。'],
    SPACE_FOLDER_CYCLE: ['Choose a destination outside the selected folder.', '请选择此文件夹之外的目录。'],
    SPACE_REPOSITORY_LIMIT: ['The space reached its repository limit.', '已达到空间关联仓库上限。'],
    spaceDetached: ['Detached repositories', '已解除关联的仓库'], spaceSnapshot: ['Knowledge snapshot', '知识快照'],
    spaceTrackLatest: ['Follow repository', '跟随仓库'],
    spaceImportDocuments: ['Import document', '导入文档'], spaceImportDocument: ['Markdown, PDF or CSV file', 'Markdown、PDF 或 CSV 文件'],
    spaceImportMode: ['Save as', '保存方式'], spaceImportNew: ['New document', '新文档'],
    spaceImportRevision: ['New revision', '新修订'], spaceImportExisting: ['Existing document', '已有文档'],
    spaceImportSave: ['Import file', '导入文件'], spaceImportReload: ['Reload documents', '重新加载文档'],
    spaceImportEncoding: ['Choose a UTF-8 Markdown file.', '请选择 UTF-8 编码的 Markdown 文件。'],
    PDF_INVALID: ['Choose a readable PDF file.', '请选择可读取的 PDF 文件。'],
    PDF_PASSWORD_REQUIRED: ['Choose a PDF that opens without a password.', '请选择无需密码即可打开的 PDF。'],
    PDF_PAGE_LIMIT: ['Import supports PDFs of up to 180 pages.', '支持导入最多 180 页的 PDF。'],
    PDF_PARSER_BUSY: ['PDF parsing is at capacity. Try again shortly.', 'PDF 解析正忙，请稍后重试。'],
    PDF_PARSE_TIMEOUT: ['PDF text extraction timed out.', 'PDF 文字提取超时。'],
    DOCUMENT_FORMAT_READ_ONLY: ['This document is read-only. Upload a PDF to add a revision.', '此文档只读，可上传 PDF 追加修订。'],
    DOCUMENT_FORMAT_MISMATCH: ['Choose a document with the same format as the uploaded file.', '请选择与上传文件格式相同的文档。'],
    DOCUMENT_VERSION_CHANGED: ['A newer revision was saved. Your draft is still here. Open the latest revision before applying your changes.', '已有更新的修订。草稿仍保留，请打开最新修订后再应用改动。'],
    SPACE_ITEM_NAME_CONFLICT: ['This name is already used in the folder.', '当前目录中已存在同名内容。'],
    SPACE_READ_ONLY: ['The space is read-only.', '该空间为只读状态。'],
    SPACE_REVISION_CHANGED: ['The space changed. Reopen it before trying again.', '空间已更新，请重新打开后再试。'],
    SPACE_STORAGE_LIMIT: ['Space storage limit reached.', '已达到空间容量上限。'], DOCUMENT_TOO_LARGE: ['Document exceeds the size limit.', '文档超过大小限制。']
};
const snapshotLabels: Record<string, [string, string]> = {
    evidenceLiveIndex: ['Current source index', '当前源码索引'],
    SNAPSHOT_VECTOR_INDEX_UNAVAILABLE: ['Vector search is unavailable for this snapshot.', '此快照的向量检索不可用。'],
    WIKI_SNAPSHOT_VECTOR_INCOMPLETE: ['The source vector index is incomplete. Reindex the repository before publishing.', '源码向量索引尚不完整，请重新索引后再发布。']
};
const gitLabels: Record<string, [string, string]> = {
    gitRepositories: ['Remote Git', '远端 Git'], gitTracking: ['Git tracking', 'Git 跟踪'], gitSync: ['Sync branch', '同步分支'],
    gitRetry: ['Retry this commit', '重试此提交'], gitCancel: ['Cancel sync', '取消同步'], gitPublished: ['Latest published Wiki', '最新已发布 Wiki'],
    gitInterval: ['Check interval in minutes', '检查间隔（分钟）'], gitEvents: ['Accept signed events', '接收签名事件'],
    gitSchedule: ['Schedule', '调度'], gitScheduleOff: ['Off', '关闭'], gitScheduleInterval: ['Interval', '固定间隔'],
    gitScheduleCalendar: ['Local time', '当地时间'], gitTimeZone: ['Time zone', '时区'], gitLocalTime: ['Local time', '当地时间'],
    gitScheduleDays: ['Run on', '运行日期'], gitScheduleSelectDay: ['Select at least one day.', '至少选择一个运行日期。'],
    gitNextCheck: ['Next scheduled check', '下次计划检查'],
    gitAutoPublish: ['Publish Wiki after sync', '同步后发布 Wiki'], gitPublicationPending: ['Wiki publication is queued', 'Wiki 发布已排队'],
    gitPublicationFailed: ['Wiki publication failed', 'Wiki 发布失败'],
    gitSaveAutomation: ['Save sync settings', '保存同步设置'], gitConnection: ['Git connection', 'Git 连接'],
    gitConnectionName: ['Connection name', '连接名称'], gitUrl: ['Repository URL', '仓库地址'],
    gitAdapter: ['Hosting platform', '托管平台'], gitGenericAdapter: ['Generic Git', '通用 Git'],
    gitSelectAdapter: ['Select a platform', '选择托管平台'], gitVerifyIdentity: ['Verify repository identity', '验证仓库身份'],
    gitReconnect: ['Verify and reconnect', '验证并重连'], gitReconnectSaved: ['Repository identity verified.', '仓库身份已验证。'],
    gitDisconnect: ['Disconnect and clear credentials', '断开连接并清除凭据'],
    gitDisconnectConfirm: ['Disconnect this repository and remove its saved token and event secret?', '要断开此仓库并移除保存的令牌和事件密钥吗？'],
    gitDisconnected: ['Connection disconnected.', '已断开 Git 连接。'],
    gitUsername: ['Git username (optional)', 'Git 用户名（可选）'], gitToken: ['Git token (optional)', 'Git 令牌（可选）'],
    gitBranch: ['Tracking branch', '跟踪分支'], gitConnectSync: ['Connect and sync', '关联并同步'],
    gitNewConnection: ['New Git connection', '新建 Git 连接'], gitIndexedCommit: ['Indexed commit', '已索引提交'],
    gitConnectionSettings: ['Connection settings', '连接设置'], gitConnectionEnabled: ['Connection enabled', '启用连接'],
    gitClearToken: ['Remove saved token', '移除已保存令牌'], gitSigningSecret: ['Event signing secret', '事件签名密钥'],
    gitClearSecret: ['Remove event signing secret', '移除事件签名密钥'], gitConnectionSave: ['Save connection', '保存连接'],
    gitConflictingCredential: ['Choose one action for each credential.', '每种凭据只能选择一个操作。'],
    gitSyncCommit: ['Synchronization target', '同步目标'], gitIdle: ['Waiting for the first sync', '等待首次同步'],
    GIT_CONNECTION_DISABLED: ['The Git connection is disabled.', 'Git 连接已停用。'],
    GIT_ORIGIN_NOT_ALLOWED: ['This Git origin is outside the server allowlist.', '此 Git 实例不在服务允许列表。'],
    GIT_REMOTE_REQUEST_FAILED: ['The Git server could not serve the request.', 'Git 服务未能处理请求。'],
    GIT_CONNECTION_EXISTS: ['This repository URL is already connected.', '此仓库地址已有连接。'],
    GIT_HOSTED_REPOSITORY_EXISTS: ['This hosted repository is already connected.', '此托管仓库已有连接。'],
    GIT_HOSTED_INSTANCE_CHANGED: ['The URL must belong to the original Git instance.', '请输入原 Git 实例上的仓库地址。'],
    GIT_HOSTED_VERIFICATION_REQUIRED: ['Verify the existing URL before moving this connection.', '请先验证当前地址，再迁移连接。'],
    GIT_REPOSITORY_IDENTITY_CHANGED: ['The hosting platform reports a different repository ID.', '托管平台返回了不同的仓库 ID。'],
    GIT_IDENTITY_UNAVAILABLE: ['The hosting API could not read the repository. Check the URL and saved token.', '托管 API 无法读取仓库，请检查地址和已保存令牌。'],
    GIT_IDENTITY_REDIRECT: ['Enter the repository’s current canonical URL.', '请输入仓库当前的规范地址。'],
    GIT_BRANCH_NOT_FOUND: ['The tracking branch was not found.', '找不到跟踪分支。'],
    GIT_SYNC_IN_PROGRESS: ['A different commit is already being synchronized.', '另一个提交正在同步。'],
    GIT_WIKI_SUBMISSION_PENDING: ['The indexed commit is waiting to be submitted for publication.', '已索引的提交正在等待提交发布。'],
    GIT_SOURCE_INDEX_FAILED: ['The commit could not be fully indexed.', '此提交未能完成索引。'],
    GIT_SOURCE_INDEX_NOT_READY: ['Synchronize the Git source before publishing.', '请先同步 Git 源码再发布。'],
    GIT_SOURCE_NOT_INDEXED: ['The Git source has not been indexed.', 'Git 源码尚未建立索引。'],
    GIT_EVENT_SECRET_REQUIRED: ['Set a signing secret on the Git connection to accept events.', '请先为 Git 连接配置事件签名密钥。']
};
const archiveLabels: Record<string, [string, string]> = {
    archiveDisplayName: ['Display name', '显示名称'], archiveRename: ['Rename archive', '重命名归档'],
    archiveReuse: ['Reuse in a new repository', '复用到新仓库'], archiveDigest: ['Original SHA-256', '原件 SHA-256'],
    archiveRenamed: ['Archive renamed', '归档已重命名'],
    ASSET_REQUEST_CONFLICT: ['This request key was used for different archive input.', '此请求标识已用于其他归档内容。'],
    ASSET_REVISION_CHANGED: ['The archive name changed. Reload it before saving.', '归档名称已更新，请重新加载后保存。'],
    ASSET_STILL_REFERENCED: ['This archive is referenced by a snapshot or project space.', '此归档仍被快照或项目空间引用。'],
    ARCHIVE_INDEX_SOURCE_MISMATCH: ['The source index differs from the original archive.', '源码索引与归档原件不一致。'],
    ARCHIVE_OBJECT_UNAVAILABLE: ['The original archive is unavailable.', '归档原件当前不可用。']
};
let language = preferredLanguage();
let theme = preference('theme') === 'dark' ? 'dark' : 'light';
let sidebarCollapsed = preference('sidebar') === 'compact';
let projects: DashboardProject[] = [];
let repositoryFilter = 'all';
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
let searchHits: Hit[] = [];
let searchPreview = 0;
let knowledgeResults: KnowledgeResults | undefined;
let knowledgeSpaces: Space[] = [];
let knowledgePinned: KnowledgeScope | undefined;
let knowledgeOptionsLoaded = false;
let graphView: { data: GraphDiagram; relation: string; target: string; projectId: string; snapshotId?: string } | undefined;
let graphSnapshot: string | undefined;
let nextPage: { path: string; args: Record<string, string>; offset: number } | undefined;
let indexRequest: AbortController | undefined;
let indexJob: IndexJob | undefined;
let repositoryDialogOpener: HTMLElement | undefined;
type RepositorySource = 'local' | 'archive' | 'git';
let repositorySource: RepositorySource = 'local';
type GitConnection = ReturnType<GitSources['listConnections']>[number];
type GitRepository = ReturnType<GitSources['details']>;
type GitSync = Awaited<ReturnType<GitSources['sync']>>;
let gitConnections: GitConnection[] = [];
let gitOverview: { repository: GitRepository; published?: WikiSnapshot } | undefined;
let gitSettings: GitConnection | undefined;
let archiveRequest: AbortController | undefined;
let archiveSubmission: { file: File; strategy: string; includeBytecode: string; key: string } | undefined;
let archiveReuseSubmission: { id: string; displayName: string; key: string } | undefined;
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
let changeComparisonRequest: { fingerprint: string; key: string } | undefined;
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
type WikiSnapshot = ReturnType<KnowledgeSnapshots['list']>[number];
type WikiLifecycle = ReturnType<SnapshotRetirement['describe']>;
type RetiredSnapshots = ReturnType<SnapshotRetirement['retired']>;
type WikiExecution = NonNullable<ReturnType<WikiSummaries['execution']>>;
type WikiDocument = SummaryDocument & { canEdit?: boolean };
type WikiArtifact = Awaited<ReturnType<import('./wiki-artifacts.js').WikiArtifacts['prepare']>>;
type WikiArtifactList = ReturnType<import('./wiki-artifacts.js').WikiArtifacts['list']>;
type WikiRevisions = ReturnType<WikiPages['revisions']>;
type WikiDraftComparison = ReturnType<WikiPages['compareDraft']>;
type WikiDraftListing = Pick<WikiDraftComparison, 'id' | 'state' | 'createdAt' | 'appliedRevisionId'>;
type WikiView = { tree: WikiNode[]; document: WikiDocument; revisions: WikiRevisions; drafts: WikiDraftListing[] };
let wikiSummary: WikiView | undefined;
let wikiScope: { projectId: string; snapshots: WikiSnapshot[]; perspective: WikiPerspective; source?: string; canManage: boolean } | undefined;
let wikiLifecycle: { active?: WikiLifecycle; retired: RetiredSnapshots } | undefined;
let wikiLifecycleRequest: { fingerprint: string; key: string } | undefined;
let wikiArtifactList: WikiArtifactList | undefined;
let wikiComparison: WikiDraftComparison | undefined;
let wikiWriteRequest: { fingerprint: string; key: string } | undefined;
let wikiEditSource: { original: string; normalized: string } | undefined;
let wikiRun: AgentRun | undefined;
let wikiExecution: WikiExecution | undefined;
let wikiSubmission: { key: string; mode: SnapshotMode; notBefore?: string } | undefined;
type Space = ReturnType<ProjectSpaces['create']>;
type SpaceDetail = ReturnType<ProjectSpaces['get']>;
type Cell = import('./csv-document.js').CsvCell;
type CellEdit = Cell & { value: string };
type SpaceItem = ReturnType<ProjectSpaces['createFolder']> & { page?: number; cell?: Cell };
type SpaceMember = ReturnType<ProjectSpaces['members']>[number];
type SpaceDocument = ReturnType<ProjectSpaces['readDocument']>;
type SpaceGenerationInput = import('zod').output<typeof spaceDocumentGeneration>;
type SpaceTrashItem = { id: string; name: string };
let spaceState: { space: SpaceDetail; folder: string | null; items: SpaceItem[]; trash: SpaceTrashItem[] } | undefined;
let spaceDocument: SpaceDocument | undefined;
const spaceDrafts = new Map<string, string>();
const spaceCsvDrafts = new Map<string, Map<string, CellEdit>>();
const csvRowsPerPage = 20;
let spaceCsv: { cell?: Cell; start: number; writable: boolean } | undefined;
let spaceSubmission: { input: string; key: string } | undefined;
const wikiReader = new DocumentReader(element('wiki-content'), t, {
    storage: element('wiki-controls'), picker: element('wiki-document-picker'), actions: element('wiki-actions')
});
let architectureReader: DocumentReader | undefined;
let sbom: Sbom | undefined;
let dependencyScan: DependencyScanResult | undefined;
let archiveOverview: { asset: ArchiveAsset; profile?: ArchiveProfile } | undefined;
const controllers = new Map<string, AbortController>();
const notes = new Map<string, { key: string; detail: string | (() => string); kind?: Severity }>();

function element<T extends HTMLElement>(id: string) { return document.getElementById(id) as T; }
function input(id: string) { return element<HTMLInputElement>(id); }
function select(id: string) { return element<HTMLSelectElement>(id); }
function el(tag: string, text: string | (() => string) = '', className = '') {
    const node = document.createElement(tag);
    if (typeof text === 'function') {
        liveMessages.set(node, text);
        node.dataset.localized = '';
        node.textContent = text();
    } else node.textContent = text;
    if (className) node.className = className;
    return node;
}
function t(key: string) {
    const catalog = language === 'zh' ? zh : englishDynamic;
    if (Object.hasOwn(catalog, key)) return catalog[key];
    if (Object.hasOwn(uiLabels, key)) return uiLabels[key][language === 'zh' ? 1 : 0];
    if (Object.hasOwn(spaceLabels, key)) return spaceLabels[key][language === 'zh' ? 1 : 0];
    if (Object.hasOwn(snapshotLabels, key)) return snapshotLabels[key][language === 'zh' ? 1 : 0];
    if (Object.hasOwn(gitLabels, key)) return gitLabels[key][language === 'zh' ? 1 : 0];
    if (Object.hasOwn(archiveLabels, key)) return archiveLabels[key][language === 'zh' ? 1 : 0];
    if (Object.hasOwn(askLabels, key)) return askLabels[key][language === 'zh' ? 1 : 0];
    if (Object.hasOwn(deviceLabels, key)) return deviceLabels[key][language === 'zh' ? 1 : 0];
    return staticEnglish.get(key) ?? key;
}
function messageKey(code: string) {
    const key = Object.hasOwn(messagesByCode, code) ? messagesByCode[code] : code;
    return Object.hasOwn(zh, key) || Object.hasOwn(uiLabels, key) || Object.hasOwn(spaceLabels, key)
        || Object.hasOwn(snapshotLabels, key) || Object.hasOwn(gitLabels, key) || Object.hasOwn(archiveLabels, key)
        || Object.hasOwn(askLabels, key) || Object.hasOwn(deviceLabels, key) ? key : undefined;
}
function diagnostic(message: string) {
    const split = message.lastIndexOf(': ');
    const key = messageKey(message.slice(split < 0 ? 0 : split + 2));
    return key ? (split < 0 ? '' : message.slice(0, split + 2)) + t(key) : message;
}
function formatNumber(value: number, fractionDigits?: number) {
    return value.toLocaleString(language, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const counts = new WeakMap<HTMLElement, { current: number; target: number; frame: number;
    format: (value: number) => string; visual: HTMLElement; readable: HTMLElement }>();

function updateCount(host: HTMLElement, target: number, animate: boolean, format = formatNumber) {
    let count = counts.get(host);
    if (!count) {
        const visual = el('span');
        visual.setAttribute('aria-hidden', 'true');
        const readable = el('span', '', 'sr-only');
        host.replaceChildren(visual, readable);
        count = { current: 0, target, frame: 0, format, visual, readable };
        counts.set(host, count);
    }
    const state = count;
    state.format = format;
    state.readable.textContent = format(target);
    const show = (value: number) => {
        state.current = value;
        state.visual.textContent = state.format(value);
    };
    if (!animate || reducedMotion.matches || state.current === target) {
        cancelAnimationFrame(state.frame);
        state.frame = 0;
        state.target = target;
        show(target);
        return;
    }
    show(state.current);
    if (state.frame && state.target === target) return;
    cancelAnimationFrame(state.frame);
    state.target = target;
    const start = state.current;
    const started = performance.now();
    const tick = (now: number) => {
        const progress = Math.max(0, Math.min(1, (now - started) / 620));
        if (!host.isConnected || reducedMotion.matches || progress >= 1) {
            state.frame = 0;
            show(target);
            return;
        }
        show(Math.round(start + (target - start) * (1 - (1 - progress) ** 3)));
        state.frame = requestAnimationFrame(tick);
    };
    state.frame = requestAnimationFrame(tick);
}

function settingsTabs(id: string, changed?: (panel: string) => void) {
    const tabs = [...element(id).querySelectorAll<HTMLButtonElement>(':scope > [role="tablist"] > [role="tab"]')];
    const panelId = (tab: HTMLButtonElement) => tab.getAttribute('aria-controls')!;
    let active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true')!;
    function selectPanel(id: string) {
        const next = tabs.find(tab => panelId(tab) === id && !tab.hidden);
        if (!next || active === next) return;
        const moveFocus = active === document.activeElement || element(panelId(active)).contains(document.activeElement);
        for (const tab of tabs) {
            const selected = tab === next;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
            element(panelId(tab)).hidden = !selected;
        }
        active = next;
        if (moveFocus) next.focus();
        changed?.(id);
    }
    for (const tab of tabs) {
        tab.addEventListener('click', () => selectPanel(panelId(tab)));
        tab.addEventListener('keydown', event => {
            const visible = tabs.filter(item => !item.hidden);
            const current = visible.indexOf(tab);
            const next = event.key === 'Home' ? visible[0] : event.key === 'End' ? visible.at(-1)
                : event.key === 'ArrowUp' ? visible[(current - 1 + visible.length) % visible.length]
                : event.key === 'ArrowDown' ? visible[(current + 1) % visible.length] : undefined;
            if (!next) return;
            event.preventDefault();
            selectPanel(panelId(next));
            next.focus();
        });
    }
    return {
        get active() { return panelId(active); },
        select: selectPanel,
        refresh() {
            if (active.hidden) {
                const first = tabs.find(tab => !tab.hidden);
                if (first) selectPanel(panelId(first));
            }
        }
    };
}
function report(id: string, key = '', detail: string | (() => string) = '', kind?: Severity) {
    const node = element(id);
    node.hidden = !key;
    if (!key) {
        notes.delete(id);
        return;
    }
    notes.set(id, { key, detail, kind });
    const value = typeof detail === 'function' ? detail() : detail;
    node.textContent = key === 'matches' ? `${formatNumber(Number(value))} ${t(value === '1' ? 'match' : 'matches')}`
        : [t(key), value].filter(Boolean).join(' · ');
    node.dataset.kind = kind ?? '';
}
function localize() {
    const draftFields = () => document.querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>('[data-locale-draft]');
    const drafts = new Map([...draftFields()].map(field => [field.dataset.localeDraft, field.value]));
    setDocumentLanguage(language);
    document.documentElement.dataset.theme = theme;
    for (const [node, original] of originals) {
        const item = node as HTMLElement;
        if (item.dataset.text) item.textContent = language === 'zh' ? t(item.dataset.text) : original;
        else if (item.dataset.placeholder) item.setAttribute('placeholder', language === 'zh' ? zh[item.dataset.placeholder] ?? original : original);
        else if (item.dataset.aria) item.setAttribute('aria-label', language === 'zh' && messageKey(item.dataset.aria) ? t(item.dataset.aria) : original);
    }
    renderSidebar();
    renderThemeControl();
    element('current-view').textContent = t(view);
    renderGraphScope();
    for (const [id, note] of notes) report(id, note.key, note.detail, note.kind);
    for (const node of document.querySelectorAll<HTMLElement>('[data-localized]')) {
        const text = liveMessages.get(node);
        if (text) node.textContent = text();
    }
    if (indexJob && !element('index-status').hidden && !notes.has('index-status')) showJob(indexJob);
    if (view === 'overview' && overview) renderOverview(overview);
    if (view === 'overview' && gitOverview) renderGitOverview(gitOverview, false);
    if (repositorySource === 'git') renderGitConnections(select('git-connection').value);
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
    if (view === 'wiki' && wikiScope) renderWikiScope();
    if (view === 'wiki' && wikiLifecycle) renderWikiLifecycle();
    if (view === 'wiki' && wikiSummary) renderWiki(wikiSummary);
    if (view === 'wiki' && wikiRun) renderWikiRun(wikiRun, wikiExecution);
    if (view === 'spaces' && spaceState) renderSpace(spaceState);
    if (view === 'repositories' && projectTrashState) renderProjectTrash();
    if (view === 'evidence' && select('evidence-snapshot').options[0]) select('evidence-snapshot').options[0].textContent = t('evidenceLiveIndex');
    if (view === 'overview' && sbom) renderSbom(sbom);
    if (view === 'overview' && dependencyScan) renderDependencyScan(dependencyScan);
    if (view === 'search') renderSearchResults();
    if (view === 'graph' && graphView) renderGraphResults(graphView);
    if (view === 'graph' && flowView) renderFlow(flowView);
    if (view === 'overview' && archiveOverview) renderArchiveProfile(archiveOverview.asset, archiveOverview.profile);
    if (view === 'admin' && administration) renderAdministration(administration, true);
    if (view === 'admin' && operations) renderOperations(operations);
    if (view === 'admin' && providers.length) renderProviderChoices();
    renderProjects();
    for (const field of draftFields()) {
        const draft = drafts.get(field.dataset.localeDraft);
        if (draft !== undefined) field.value = draft;
    }
}
for (const item of document.querySelectorAll<HTMLElement>('[data-text], [data-placeholder], [data-aria]')) {
    const original = item.dataset.text ? item.textContent?.trim()
        : item.getAttribute(item.dataset.placeholder ? 'placeholder' : 'aria-label');
    originals.set(item, original ?? '');
    if (item.dataset.text && original) staticEnglish.set(item.dataset.text, original);
}

class RequestError extends Error {
    constructor(readonly status: number, readonly code: string, readonly requestId?: string, readonly details?: unknown) { super(code); }
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
    if (!response.ok) throw new RequestError(response.status, typeof body.error === 'string' ? body.error : 'REQUEST_FAILED',
        response.headers.get('X-Request-Id') ?? undefined, path === '/search/knowledge' ? body : undefined);
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
        const known = messageKey(error.code);
        report(id, known ?? 'failed', () => [known ? '' : error.code,
            error.status >= 500 && error.requestId ? t('operationsRequestId') + ' ' + error.requestId : ''].filter(Boolean).join(' · '), 'error');
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

function renderThemeControl() {
    const control = element('theme');
    control.setAttribute('aria-pressed', String(theme === 'dark'));
    const label = t('toggleTheme');
    control.setAttribute('aria-label', label);
    control.title = label;
}

function closeMenu() {
    element('sidebar').classList.remove('open');
    element('nav-scrim').hidden = true;
    element('workspace-app').inert = false;
    element('menu').setAttribute('aria-expanded', 'false');
}
function renderSidebar() {
    element('workspace').dataset.sidebar = sidebarCollapsed ? 'compact' : 'full';
    const toggle = element('collapse-nav');
    const label = t(sidebarCollapsed ? 'expandNavigation' : 'collapseNavigation');
    toggle.setAttribute('aria-expanded', String(!sidebarCollapsed));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.sidebar nav a[data-view]')) {
        link.title = sidebarCollapsed ? t(link.dataset.view ?? '') : '';
    }
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
    window.scrollTo(0, 0);
}
type AskSessionView = Awaited<ReturnType<import('./ask-conversations.js').AskConversations['create']>>;
type AskEventView = ReturnType<import('./ask-conversations.js').AskConversations['events']>['events'][number];
type AskCitationView = import('./ask-evidence.js').AskCitation;
type AskAttachmentView = ReturnType<import('./ask-conversations.js').AskConversations['listAttachments']>[number];
type AskAttachmentText = ReturnType<import('./ask-conversations.js').AskConversations['readAttachment']>;
let askSession: AskSessionView | undefined;
let askCursor = 0;
let askCurrentTurn = '';
let askRequest: { sessionId: string; question: string; key: string } | undefined;
let askCreation: { fingerprint: string; key: string } | undefined;
let askAttachmentChange: { fingerprint: string; key: string } | undefined;
let askPdfPreview: { file: AskAttachmentView; pages: NonNullable<AskAttachmentText['pdfPages']> } | undefined;

function askUrl(id: string) { return '/ask/sessions/' + id; }
function askAttachmentUrl(sessionId: string, attachmentId: string) { return askUrl(sessionId) + '/attachments/' + attachmentId; }

function closeAskAttachment() {
    controllers.get('ask-attachment')?.abort();
    const dialog = element<HTMLDialogElement>('ask-attachment-dialog');
    if (dialog.open) dialog.close();
    element('ask-attachment-content').replaceChildren();
    element('ask-attachment-download').removeAttribute('href');
    element('ask-attachment-download').hidden = true;
    element('ask-attachment-page-field').hidden = true;
    select('ask-attachment-page').replaceChildren();
    askPdfPreview = undefined;
}

function clearAsk() {
    askSession = undefined;
    askCursor = 0;
    askCurrentTurn = '';
    askRequest = undefined;
    element('ask-thread').hidden = true;
    element('ask-timeline').replaceChildren();
    element('ask-attachment-list').replaceChildren();
    element('ask-attachments').hidden = true;
    element<HTMLTextAreaElement>('ask-question').value = '';
    closeAskAttachment();
}

function loadAsk(params: URLSearchParams) {
    controllers.get('ask-feed')?.abort();
    controllers.get('ask-write')?.abort();
    const opened = params.get('session');
    const snapshotId = params.get('snapshotId');
    clearAsk();
    report('ask-feed-status');
    report('ask-write-status');
    void run('ask', async signal => {
        const [sessions, spaces] = await Promise.all([
            api<AskSessionView[]>('/ask/sessions', {}, { signal }),
            api<{ id: string; name: string }[]>('/spaces', {}, { signal })
        ]);
        let session: AskSessionView | undefined;
        let blocked = false;
        if (isUuid(opened)) {
            try { session = await api<AskSessionView>(askUrl(opened), {}, { signal }); }
            catch (error) {
                if (!(error instanceof RequestError && error.code === 'ASK_ATTACHMENT_REMOVED')) throw error;
                session = sessions.find(item => item.id === opened);
                blocked = true;
            }
        }
        const attachments = session?.scope.attachments?.length
            ? await api<AskAttachmentView[]>(askUrl(session.id) + '/attachments', {}, { signal }) : [];
        return { sessions, spaces, session, blocked, attachments };
    }, result => {
        report('ask-status');
        const picker = select('ask-session-select');
        picker.replaceChildren(new Option(t('askNew'), ''), ...result.sessions.map((item, index) =>
            new Option(item.title ?? t('ask') + ' ' + (result.sessions.length - index), item.id)));
        picker.value = result.session?.id ?? '';
        const repositories = select('ask-projects');
        repositories.replaceChildren(...projects.map(project => new Option(repositoryName(project), project.projectId, false, project.projectId === selected)));
        select('ask-spaces').replaceChildren(...result.spaces.map(space => new Option(space.name, space.id)));
        const note = element('ask-frozen-selection');
        note.hidden = !isUuid(snapshotId) || !selected || Boolean(result.session);
        note.textContent = isUuid(snapshotId) ? t('askFrozenSnapshot') + ' · ' + snapshotId.slice(0, 8) : '';
        askSession = result.blocked ? undefined : result.session;
        if (!result.session) return;
        if (result.blocked) report('ask-status', 'askAttachmentAffected', '', 'warning');
        element('ask-thread').hidden = false;
        element('ask-thread-title').textContent = result.session.title ?? t('ask');
        const review = result.session.scope.review;
        element('ask-thread-version').textContent = review ? t('askFrozenReview') + ' · ' + review.reviewId.slice(0, 8)
            : result.session.scope.repositories.map(ref =>
            (projects.find(project => project.projectId === ref.projectId)?.projectName ?? ref.projectId) + ' @ ' + ref.snapshotId.slice(0, 8))
            .concat(result.session.scope.documents.length ? [result.session.scope.documents.length + ' ' + t('spaceDocuments')] : []).join(' · ');
        element('ask-question-form').hidden = result.blocked;
        renderAskAttachments(result.session.id, result.attachments);
        const pointed = result.attachments.find(item => item.attachmentId === params.get('attachment')
            && item.versionId === params.get('revision') && item.removedAt === null);
        if (pointed) openAskAttachment(result.session.id, pointed, Number(params.get('line')) || 1, Number(params.get('page')) || 1);
        updateAskControls();
        if (askSession) trackAsk(result.session.id);
    });
}

function renderAskAttachments(sessionId: string, files: AskAttachmentView[]) {
    element('ask-attachments').hidden = !files.length;
    element('ask-attachment-list').replaceChildren(...files.map(file => {
        const item = el('li');
        const controls = el('div', '', 'row-actions');
        item.append(el('span', file.name));
        const gone = file.removedAt !== null;
        if (gone) item.append(el('span', () => t('askAttachmentRemoved'), 'subtle'));
        else controls.append(resultButton('askAttachmentPreview', () => openAskAttachment(sessionId, file)));
        controls.append(resultButton(gone ? 'askAttachmentRestore' : 'askAttachmentRemove',
            () => changeAskAttachment(sessionId, file, gone ? 'restore' : 'remove')));
        item.append(controls);
        return item;
    }));
}

function displayAskPdfPage(page: number, line = 1) {
    if (!askPdfPreview) return;
    const { file, pages } = askPdfPreview;
    const selected = pages[page - 1];
    if (!selected) return;
    const preview = element('ask-attachment-content');
    preview.textContent = selected.text;
    preview.scrollTop = Math.max(0, line - 3) * (parseFloat(getComputedStyle(preview).lineHeight) || 20);
    element('ask-attachment-version').textContent = file.name + ' · ' + file.versionId.slice(0, 8)
        + ' · ' + t('spacePdfPage') + ' ' + page + '/' + pages.length;
    report('ask-attachment-status', selected.truncated ? 'spacePdfTruncated' : !selected.text.trim() ? 'spacePdfNoText' : '');
}

function openAskAttachment(sessionId: string, file: AskAttachmentView, line = 1, page = 1) {
    closeAskAttachment();
    const dialog = element<HTMLDialogElement>('ask-attachment-dialog');
    element('ask-attachment-version').textContent = file.name + ' · ' + file.versionId.slice(0, 8);
    dialog.showModal();
    const path = askAttachmentUrl(sessionId, file.attachmentId);
    void run('ask-attachment', signal => api<AskAttachmentText>(path, { versionId: file.versionId }, { signal }), document => {
        const download = element<HTMLAnchorElement>('ask-attachment-download');
        download.href = '/api/v1' + path + '/download?' + new URLSearchParams({ versionId: file.versionId });
        download.hidden = false;
        if (document.pdfPages) {
            askPdfPreview = { file, pages: document.pdfPages };
            const chosen = Number.isInteger(page) && document.pdfPages[page - 1] ? page : 1;
            const control = select('ask-attachment-page');
            control.replaceChildren(...document.pdfPages.map((_, index) => new Option(String(index + 1), String(index + 1))));
            control.value = String(chosen);
            element('ask-attachment-page-field').hidden = false;
            displayAskPdfPage(chosen, line);
        } else {
            const lines = document.text.split(/\r\n|\n|\r/);
            const focus = Math.min(lines.length, Math.max(1, Math.floor(line)));
            const start = Math.max(1, focus - 8);
            const end = Math.min(lines.length, start + 119);
            const text = lines.slice(start - 1, end).map((value, index) => `${start + index}  ${value}`).join('\n');
            element('ask-attachment-content').textContent = text.slice(0, 64_000);
            element('ask-attachment-version').textContent = file.name + ' · ' + file.versionId.slice(0, 8)
                + ' · ' + t('askAttachmentLines') + ' ' + start + '–' + end + (text.length > 64_000 ? ' · ' + t('askAttachmentClipped') : '');
            report('ask-attachment-status');
        }
    });
}

function changeAskAttachment(sessionId: string, file: AskAttachmentView, action: 'remove' | 'restore') {
    if (controllers.has('ask-write')) return;
    const payload = { action, revision: file.revision };
    const fingerprint = JSON.stringify([sessionId, file.attachmentId, payload]);
    if (askAttachmentChange?.fingerprint !== fingerprint) askAttachmentChange = { fingerprint, key: crypto.randomUUID() };
    const key = askAttachmentChange.key;
    void run('ask-write', signal => api(askAttachmentUrl(sessionId, file.attachmentId), {},
        { ...jsonRequest(payload, 'POST', signal), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key } }), () => {
        askAttachmentChange = undefined;
        loadAsk(new URL(location.href).searchParams);
    });
}

function askCitationLink(citation: AskCitationView, turnId: string) {
    const link = el('a', () => citation.id + ' · ' + citation.title +
        ((citation.kind === 'DOCUMENT' || citation.kind === 'ATTACHMENT') && citation.page
            ? ' · ' + t('spacePdfPage') + ' ' + citation.page : '')
        + (citation.kind === 'DOCUMENT' && citation.cell ? ' · ' + cellLabel(citation.cell) : '')) as HTMLAnchorElement;
    if (askSession) link.href = '/api/v1' + askUrl(askSession.id) + '/turns/' + turnId + '/citations/' + citation.id + '?open=1';
    return link;
}

function askEvidenceList(citations: AskCitationView[], turnId: string) {
    const list = el('ul', '', 'space-list');
    for (const citation of citations) {
        const item = el('li');
        const disclosure = el('details');
        const title = el('summary');
        title.append(askCitationLink(citation, turnId));
        disclosure.append(title, el('pre', citation.excerpt));
        item.append(disclosure);
        list.append(item);
    }
    return list;
}

function recordAskEvent(event: AskEventView) {
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= askCursor) return;
    askCursor = event.sequence;
    const data = event.data as { question?: string; answer?: string; citations?: AskCitationView[]; status?: string; reason?: string;
        coverage?: { carriedCitations?: number } };
    const timeline = element('ask-timeline');
    if (event.type === 'USER_MESSAGE') {
        askCurrentTurn = event.turnId;
        const item = el('article', '', 'ask-message');
        item.append(el('strong', () => t('askQuestion')), el('p', data.question ?? ''));
        timeline.append(item);
    } else if (event.type === 'ASSISTANT_MESSAGE') {
        const item = el('article', '', 'ask-message');
        item.append(el('strong', () => t('askAnswer')), el('p', data.answer ?? ''), askEvidenceList(data.citations ?? [], event.turnId));
        timeline.append(item);
    } else if (event.type === 'EVIDENCE' && data.citations?.length) {
        const disclosure = el('details', '', 'ask-message');
        const label = data.coverage?.carriedCitations ? 'askCarriedEvidence' : 'askEvidence';
        disclosure.append(el('summary', () => t(label) + ' · ' + data.citations!.length), askEvidenceList(data.citations, event.turnId));
        timeline.append(disclosure);
    } else if (event.type === 'TURN_FINISHED') {
        if (askCurrentTurn === event.turnId) askCurrentTurn = '';
        if (data.status !== 'COMPLETED') timeline.append(el('p', () =>
            [t(data.status ?? ''), data.reason && t(data.reason)].filter(Boolean).join(' · '), 'hint'));
    }
    updateAskControls();
}

function updateAskControls() {
    element<HTMLFormElement>('ask-question-form').querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = Boolean(askCurrentTurn);
    element('ask-cancel').hidden = !askCurrentTurn;
}

async function streamAsk(sessionId: string, signal: AbortSignal) {
    const path = '/api/v1' + askUrl(sessionId) + '/events';
    const response = await fetch(path + '?after=' + askCursor, { credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'text/event-stream' }, signal });
    if (!response.ok) {
        const error = await response.json();
        throw new RequestError(response.status, error.error);
    }
    if (!response.body) throw new Error('Ask stream unavailable');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    try {
        for (;;) {
            const received = await reader.read();
            if (received.done || signal.aborted) break;
            buffered += received.value;
            let end = buffered.indexOf('\n\n');
            while (end >= 0) {
                const packet = buffered.slice(0, end);
                buffered = buffered.slice(end + 2);
                if (packet.startsWith('event: stream-error')) {
                    const code = JSON.parse(packet.split('\ndata: ')[1]).code;
                    throw new RequestError(code === 'ASK_SCOPE_ACCESS_CHANGED' ? 403 : 503, code);
                }
                const json = packet.split('\n').find(line => line.startsWith('data: '));
                if (json) recordAskEvent(JSON.parse(json.slice(6)));
                end = buffered.indexOf('\n\n');
            }
        }
    } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

function trackAsk(sessionId: string) {
    void run('ask-feed', async signal => {
        report('ask-feed-status');
        while (!signal.aborted && askSession?.id === sessionId) {
            try {
                await streamAsk(sessionId, signal);
                if (!signal.aborted) report('ask-feed-status');
            } catch (error) {
                if (signal.aborted) break;
                if (error instanceof RequestError && [401, 403, 404, 409].includes(error.status)) {
                    clearAsk();
                    throw error;
                }
                showFailure('ask-feed-status', error);
            }
            if (signal.aborted) break;
            await new Promise(resolve => setTimeout(resolve, 2500));
        }
    }, () => {});
}

type SpaceLocation = { folder?: string; item?: string; revision?: string; page?: string; row?: string; column?: string; q?: string };

function openSpace(id: string, params: SpaceLocation = {}) {
    navigate('spaces', '', { space: id, ...params });
}

function spaceLinkNode(name: string, id: string, params: SpaceLocation = {}) {
    const link = el('a', name) as HTMLAnchorElement;
    link.href = route('spaces', '', { space: id, ...params });
    link.addEventListener('click', event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openSpace(id, params);
    });
    return link;
}

function spaceButton(label: string, action: () => void) {
    const button = el('button', () => t(label)) as HTMLButtonElement;
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
}

function spaceItemRow(item: HTMLElement, ...actions: HTMLElement[]) {
    const row = el('li');
    row.append(item, ...actions);
    return row;
}

function writableSpace(space: SpaceDetail) {
    return space.status === 'ACTIVE' && space.role !== 'VIEWER';
}

function canManageSpace(space: SpaceDetail) {
    return space.role === 'OWNER' || space.role === 'ADMIN';
}

let spaceSettings: SpaceDetail | undefined;
let spaceSettingsId: string | undefined;
const editableSpaceRoles = ['VIEWER', 'EDITOR', 'ADMIN'] as const;

function setSpaceRoleOptions(control: HTMLSelectElement, role: SpaceMember['role'] = 'VIEWER') {
    control.replaceChildren(...editableSpaceRoles.map(choice => new Option(t('spaceRole:' + choice), choice)));
    control.value = role;
}

function renderSpaceSettings(space: SpaceDetail, members: SpaceMember[]) {
    spaceSettings = space;
    if (spaceState?.space.id === space.id) spaceState = { ...spaceState, space };
    element('space-settings-name').textContent = space.name;
    for (const [field, value] of [['space-settings-input', space.name], ['space-max-repositories', space.maxRepositories],
        ['space-max-file-bytes', space.maxFileBytes], ['space-max-bytes', space.maxBytes]] as const) input(field).value = String(value);
    element('space-used-bytes').textContent = t('spaceUsage') + ' · ' + formatNumber(space.usedBytes);
    for (const control of element<HTMLFormElement>('space-settings-limits').querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) {
        control.disabled = space.status !== 'ACTIVE';
    }
    const rows = members.map(member => {
        const label = el('span', member.username ? `${member.displayName || member.username} · @${member.username}` : member.accountId);
        label.append(el('small', () => ' · ' + t('spaceRole:' + member.role)));
        if (member.role === 'OWNER' || space.status !== 'ACTIVE') return spaceItemRow(label);
        const role = document.createElement('select');
        role.setAttribute('aria-label', t('spaceRole') + ' · ' + (member.username ?? member.accountId));
        setSpaceRoleOptions(role, member.role);
        const save = spaceButton('spaceSaveRole', () => changeSpaceMember({ accountId: member.accountId, role: role.value }));
        save.disabled = true;
        role.disabled = member.status !== 'ACTIVE';
        role.addEventListener('change', () => { save.disabled = role.value === member.role; });
        const revoke = spaceButton('spaceRevokeRole', () => changeSpaceMember({ accountId: member.accountId, role: null }));
        const transfer = space.role === 'OWNER' && member.status === 'ACTIVE' ? [spaceButton('spaceTransfer', () => {
            if (window.confirm(t('spaceTransferConfirm'))) applySpaceSettings('/transfer', 'POST', { accountId: member.accountId });
        })] : [];
        return spaceItemRow(label, role, save, revoke, ...transfer);
    });
    element('space-member-list').replaceChildren(...rows);
    element('space-add-member').hidden = space.status !== 'ACTIVE';
    element('space-settings-content').hidden = false;
}

function readSpaceSettings(id: string, signal: AbortSignal) {
    const path = '/spaces/' + id;
    return Promise.all([api<SpaceDetail>(path, {}, { signal }), api<SpaceMember[]>(path + '/members', { details: 'true' }, { signal })]);
}

function loadSpaceSettings(id: string) {
    void run('space-settings', signal => readSpaceSettings(id, signal), ([space, members]) => {
        renderSpaceSettings(space, members);
        report('space-settings-status');
    });
}

function openSpaceSettings() {
    const space = spaceState?.space;
    if (!space || !canManageSpace(space)) return;
    spaceSettingsId = space.id;
    spaceSettings = undefined;
    element('space-settings-name').textContent = space.name;
    element('space-settings-content').hidden = true;
    input('space-member-username').value = '';
    setSpaceRoleOptions(select('space-add-role'));
    element<HTMLDialogElement>('space-settings').showModal();
    loadSpaceSettings(space.id);
}

function applySpaceSettings(path: string, method: 'PATCH' | 'PUT' | 'POST', fields: object, success?: () => void) {
    const space = spaceSettings;
    if (!space || controllers.has('space-settings')) return;
    void run('space-settings', async signal => {
        await api('/spaces/' + space.id + path, {}, jsonRequest({ ...fields, revision: space.revision }, method, signal));
        if (success) return undefined;
        return readSpaceSettings(space.id, signal);
    }, result => {
        if (result) {
            renderSpaceSettings(...result);
            if ('username' in fields) input('space-member-username').value = '';
            report('space-settings-status', 'spaceSettingsSaved', '', 'success');
        }
        success?.();
    });
}

function changeSpaceMember(input: { username?: string; accountId?: string; role: string | null }) {
    applySpaceSettings('/members', 'PUT', input);
}

function loadDeletedSpaces() {
    if (!element<HTMLDetailsElement>('space-deleted-list').open || !connected) return;
    void run('space-deleted', signal => api<Space[]>('/spaces', { deleted: 'true' }, { signal }), spaces => {
        const items = spaces.map(space => spaceItemRow(el('span', space.name), spaceButton('spaceRestore', () => manageSpace(signal =>
            api('/spaces/' + space.id, {}, jsonRequest({ status: 'ACTIVE', revision: space.revision }, 'PATCH', signal)), () => {
            openSpace(space.id);
            loadDeletedSpaces();
        }))));
        element('space-deleted-items').replaceChildren(...items.length ? items : [el('li', () => t('spaceEmpty'), 'hint')]);
        report('space-deleted-status');
    });
}

function loadSpaceLinkSnapshots() {
    const space = spaceState?.space;
    const project = select('space-repository').value;
    const field = select('space-link-snapshot');
    controllers.get('space-link-snapshots')?.abort();
    field.replaceChildren(new Option(t('spaceTrackLatest'), ''));
    report('space-link-snapshots-status');
    if (!space || !project || !writableSpace(space)) return;
    field.disabled = true;
    void run('space-link-snapshots', signal => api<WikiSnapshot[]>('/knowledge-snapshots', { projectId: project, limit: '100' }, { signal }), snapshots => {
        for (const snapshot of snapshots) field.append(new Option(snapshot.id.slice(0, 8) + ' · ' + new Date(snapshot.publishedAt).toLocaleString(language), snapshot.id));
        report('space-link-snapshots-status');
    }).finally(() => {
        if (!controllers.has('space-link-snapshots')) field.disabled = false;
    });
}

function loadDetachedSpaceRepositories() {
    const space = spaceState?.space;
    if (!space || !writableSpace(space) || !element<HTMLDetailsElement>('space-detached').open) return;
    const base = '/spaces/' + space.id + '/repositories/';
    void run('space-detached', signal => api<SpaceDetail['repositories']>(base + 'detached', {}, { signal }), entries => {
        const list = entries.map(entry => {
            const project = projects.find(item => item.projectId === entry.projectId);
            const title = (project ? repositoryName(project) : entry.projectId) + ' · ' + (entry.snapshotId?.slice(0, 8) ?? t('spaceTrackLatest'));
            return spaceItemRow(el('span', title), spaceButton('spaceRestore', () => manageSpace(signal =>
                api(base + entry.projectId + '/restore', {}, jsonRequest({ revision: space.revision }, 'POST', signal)))));
        });
        element('space-detached-items').replaceChildren(...list.length ? list : [el('li', () => t('spaceEmpty'), 'hint')]);
        report('space-detached-status');
    });
}

type MoveFolder = { id: string; name: string };
let spaceMove: { spaceId: string; item: SpaceItem; trail?: MoveFolder[] } | undefined;

function browseSpaceDestination(trail?: MoveFolder[]) {
    const move = spaceMove;
    if (!move) return;
    move.trail = trail;
    const folders = element('space-move-folders');
    folders.replaceChildren();
    element('space-move-path').textContent = trail ? [t('spaceUp'), ...trail.map(folder => folder.name)].join(' / ') : t('spaceKeepFolder');
    element('space-move-up').hidden = !trail?.length;
    if (!trail) {
        controllers.get('space-move-folders')?.abort();
        report('space-move-folders-status');
        return;
    }
    const destination = trail.at(-1)?.id;
    void run('space-move-folders', signal => api<SpaceItem[]>('/spaces/' + move.spaceId + '/items',
        destination ? { parentId: destination } : {}, { signal }), items => {
        const children = items.filter(item => item.kind === 'FOLDER' && item.id !== move.item.id);
        const rows = children.map(child => {
            const button = el('button', child.name) as HTMLButtonElement;
            button.type = 'button';
            button.addEventListener('click', () => browseSpaceDestination([...trail, child]));
            return spaceItemRow(button);
        });
        folders.replaceChildren(...rows.length ? rows : [el('li', () => t('spaceFolderEmpty'), 'hint')]);
        report('space-move-folders-status');
    });
}

function openSpaceMove(spaceId: string, item: SpaceItem) {
    spaceMove = { spaceId, item };
    input('space-move-name').value = item.name;
    report('space-move-status');
    element<HTMLDialogElement>('space-move').showModal();
    browseSpaceDestination(item.parentId ? undefined : []);
    input('space-move-name').focus();
}

function saveSpaceMove() {
    const move = spaceMove;
    if (!move || controllers.has('space-move')) return;
    const parentId = move.trail ? move.trail.at(-1)?.id ?? null : move.item.parentId;
    const name = input('space-move-name').value.trim();
    if (!name) return;
    const revision = spaceDocument?.id === move.item.id ? spaceDocument.version.id : undefined;
    const submit = element<HTMLButtonElement>('space-move-submit');
    submit.disabled = true;
    void run('space-move', signal => api<SpaceItem>('/spaces/' + move.spaceId + '/items/' + move.item.id, {},
        jsonRequest({ parentId, name }, 'PATCH', signal)), saved => {
        element<HTMLDialogElement>('space-move').close();
        openSpace(move.spaceId, saved.kind === 'FOLDER' ? { folder: saved.id } : {
            item: saved.id, ...(saved.parentId ? { folder: saved.parentId } : {}), ...(revision ? { revision } : {})
        });
    }).finally(() => { submit.disabled = false; });
}

let spaceImport: { spaceId: string; folder: string | null; targets: SpaceItem[] } | undefined;
let spaceImportSubmission: { fingerprint: string; key: string } | undefined;

function updateSpaceImport() {
    const revision = select('space-import-mode').value === 'revision';
    element('space-import-name-label').hidden = revision;
    element('space-import-target-label').hidden = !revision;
    element('space-import-reload').hidden = !revision;
    input('space-import-name').disabled = revision;
    select('space-import-target').disabled = !revision;
    select('space-import-target').required = revision;
}

function loadSpaceImportTargets() {
    const state = spaceImport;
    if (!state) return;
    void run('space-import-targets', signal => api<SpaceItem[]>('/spaces/' + state.spaceId + '/items',
        state.folder ? { parentId: state.folder } : {}, { signal }), items => {
        state.targets = items.filter(item => item.kind !== 'FOLDER' && item.versionId);
        renderSpaceImportTargets();
        report('space-import-targets-status');
    });
}

function openSpaceImport() {
    const state = spaceState;
    if (!state || !writableSpace(state.space)) return;
    spaceImport = { spaceId: state.space.id, folder: state.folder, targets: [] };
    element<HTMLFormElement>('space-import-form').reset();
    select('space-import-target').replaceChildren(new Option(t('choose'), ''));
    updateSpaceImport();
    report('space-import-status');
    element<HTMLDialogElement>('space-import').showModal();
    loadSpaceImportTargets();
}

function spaceImportType(file: File) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'application/pdf';
    if (file.type === 'text/csv' || /\.csv$/i.test(file.name)) return 'text/csv';
    return 'text/markdown';
}

function renderSpaceImportTargets() {
    const control = select('space-import-target');
    const selected = control.value;
    const file = input('space-import-file').files?.[0];
    const targets = spaceImport?.targets.filter(item => !file || item.mediaType === spaceImportType(file)) ?? [];
    const match = file && targets.find(item => item.name === file.name);
    options('space-import-target', targets.map(item => [item.id, item.name]), 'choose');
    control.value = match?.id ?? (targets.some(item => item.id === selected) ? selected : '');
}

function importSpaceDocument() {
    const state = spaceImport;
    const file = input('space-import-file').files?.[0];
    if (!state || !file || controllers.has('space-import')) return;
    if (file.size > 2 * 1024 * 1024) { report('space-import-status', 'DOCUMENT_TOO_LARGE', '', 'error'); return; }
    const revision = select('space-import-mode').value === 'revision';
    const target = state.targets.find(item => item.id === select('space-import-target').value);
    const name = input('space-import-name').value.trim();
    if (revision ? !target?.versionId : !name) return;
    const path = '/spaces/' + state.spaceId + '/documents' + (revision ? '/' + target!.id : '');
    const placement = revision ? { baseVersionId: target!.versionId } : { parentId: state.folder, name };
    const submit = element<HTMLButtonElement>('space-import-submit');
    submit.disabled = true;
    void run('space-import', async signal => {
        const bytes = await file.arrayBuffer();
        const mediaType = spaceImportType(file);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        signal.throwIfAborted();
        const fingerprint = JSON.stringify([path, placement, mediaType, Array.from(digest)]);
        if (spaceImportSubmission?.fingerprint !== fingerprint) spaceImportSubmission = { fingerprint, key: crypto.randomUUID() };
        const method = revision ? 'PUT' : 'POST';
        if (mediaType !== 'text/markdown') {
            const query: Record<string, string> = revision ? { baseVersionId: target!.versionId! }
                : { name, ...(state.folder ? { parentId: state.folder } : {}) };
            return api<SpaceDocument>(path, query, { method, signal, body: bytes, headers: {
                'Content-Type': mediaType, 'Idempotency-Key': spaceImportSubmission.key
            } });
        }
        let markdown: string;
        try { markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { throw new RequestError(400, 'spaceImportEncoding'); }
        return api<SpaceDocument>(path, {}, jsonRequest({ ...placement, markdown, key: spaceImportSubmission.key }, method, signal));
    }, saved => {
        spaceImportSubmission = undefined;
        element<HTMLDialogElement>('space-import').close();
        openSpace(saved.spaceId, { item: saved.id, revision: saved.version.id, ...(saved.parentId ? { folder: saved.parentId } : {}) });
        report('space-action-status', 'spaceSaved', '', 'success');
    }).finally(() => { submit.disabled = false; });
}

let spaceGenerationTarget: { spaceId: string; target: SpaceGenerationInput['target'] } | undefined;
let spaceGenerationSubmission: { fingerprint: string; key: string } | undefined;

function openSpaceGeneration(edit: boolean) {
    const state = spaceState;
    if (!state || !writableSpace(state.space)) return;
    const doc = spaceDocument;
    if (edit && (!doc || doc.version.id !== doc.versionId)) return;
    const name = edit ? doc!.name : input('space-item-name').value.trim();
    if (!name) return;
    spaceGenerationTarget = { spaceId: state.space.id, target: edit ? { itemId: doc!.id, baseVersionId: doc!.version.id }
        : { name, parentId: state.folder } };
    element('space-generation-target').textContent = [state.space.name, name, edit ? '#' + doc!.version.ordinal : ''].filter(Boolean).join(' · ');
    element('space-generation-form').hidden = false;
    element<HTMLButtonElement>('space-generation-submit').disabled = false;
    element<HTMLTextAreaElement>('space-generation-instruction').value = '';
    element('space-generation-result').hidden = true;
    element('space-generation-result').replaceChildren();
    report('space-generation-status');
    element<HTMLDialogElement>('space-generation').showModal();
    element<HTMLTextAreaElement>('space-generation-instruction').focus();
}

function generateSpaceDocument() {
    const selection = spaceGenerationTarget;
    const instruction = element<HTMLTextAreaElement>('space-generation-instruction').value.trim();
    if (!selection || !instruction || controllers.has('space-generation')) return;
    const fingerprint = JSON.stringify([selection, instruction]);
    if (spaceGenerationSubmission?.fingerprint !== fingerprint) spaceGenerationSubmission = { fingerprint, key: crypto.randomUUID() };
    const submit = element<HTMLButtonElement>('space-generation-submit');
    const key = spaceGenerationSubmission.key;
    submit.disabled = true;
    void run('space-generation', signal => api<SpaceDocument>('/spaces/' + selection.spaceId + '/documents/generate', {},
        jsonRequest({ target: selection.target, instruction, key }, 'POST', signal)), saved => {
        spaceGenerationSubmission = undefined;
        if ('name' in selection.target) input('space-item-name').value = '';
        element('space-generation-form').hidden = true;
        report('space-generation-status', 'spaceSaved', '', 'success');
        const result = element('space-generation-result');
        const link = spaceLinkNode(saved.name + ' · #' + saved.version.ordinal, saved.spaceId, { item: saved.id, revision: saved.version.id,
            ...(saved.parentId ? { folder: saved.parentId } : {}) });
        link.addEventListener('click', () => element<HTMLDialogElement>('space-generation').close());
        result.replaceChildren(link);
        result.hidden = false;
        link.focus();
    }).finally(() => { submit.disabled = false; });
}

function manageSpace(task: (signal: AbortSignal) => Promise<unknown>, success?: () => void) {
    if (controllers.has('space-action')) return;
    void run('space-action', task, () => {
        report('space-action-status');
        if (success) success();
        else loadSpaces(new URL(location.href).searchParams);
    });
}

function renderSpace(state: NonNullable<typeof spaceState>) {
    const { space, folder, items, trash } = state;
    const base = '/spaces/' + space.id;
    const writable = writableSpace(space);
    element('space-content').hidden = false;
    element('space-name-title').textContent = space.name;
    element('space-state').hidden = space.status !== 'ARCHIVED';
    element('space-state').textContent = t('spaceArchived');
    const manager = canManageSpace(space);
    element('space-settings-open').hidden = !manager;
    element('space-archive').hidden = !manager || space.status !== 'ACTIVE';
    element('space-reactivate').hidden = !manager || space.status !== 'ARCHIVED';
    element('space-link').hidden = !writable;
    element('space-detached').hidden = !writable;
    element('space-add-item').hidden = !writable;
    element('space-trash').hidden = !writable;
    element('space-up').hidden = !folder;
    const available = projects.filter(project => !space.repositories.some(link => link.projectId === project.projectId));
    const source = select('space-repository');
    const previousProject = source.value;
    source.replaceChildren(...available.map(project => new Option(repositoryName(project), project.projectId)));
    if (available.some(project => project.projectId === previousProject)) source.value = previousProject;
    if (writable) {
        if (source.value !== previousProject || !select('space-link-snapshot').options.length) loadSpaceLinkSnapshots();
        else select('space-link-snapshot').options[0].textContent = t('spaceTrackLatest');
        loadDetachedSpaceRepositories();
    }
    element<HTMLButtonElement>('space-link').querySelector('button')!.disabled = !available.length;
    const repositories = space.repositories.map(link => {
        const project = projects.find(project => project.projectId === link.projectId);
        const anchor = el('a', (project ? repositoryName(project) : link.projectId) + (link.snapshotId ? ' · ' + link.snapshotId.slice(0, 8) : '')) as HTMLAnchorElement;
        anchor.href = link.snapshotId ? route('wiki', link.projectId, { snapshotId: link.snapshotId }) : route('overview', link.projectId);
        const unlink = writable ? [spaceButton('spaceUnlink', () => manageSpace(signal =>
            api(base + '/repositories/' + link.projectId, { revision: String(space.revision) }, { method: 'DELETE', signal })))] : [];
        return spaceItemRow(anchor, ...unlink);
    });
    element('space-repositories').replaceChildren(...repositories.length ? repositories : [el('li', () => t('spaceEmpty'), 'hint')]);
    const rows = items.map(item => {
        const target = item.kind === 'FOLDER' ? { folder: item.id } : { item: item.id, ...(item.parentId ? { folder: item.parentId } : {}),
            ...(item.page && item.versionId ? { page: String(item.page), revision: item.versionId } : {}),
            ...(item.cell && item.versionId ? { row: String(item.cell.row), column: String(item.cell.column), revision: item.versionId } : {}) };
        const actions = writable ? [spaceButton('spaceMove', () => openSpaceMove(space.id, item)), spaceButton('spaceDelete', () => manageSpace(signal =>
            api(base + '/items/' + item.id, {}, { method: 'DELETE', signal }), () => openSpace(space.id, folder ? { folder } : {})))] : [];
        return spaceItemRow(spaceLinkNode(item.name, space.id, target), ...actions);
    });
    element('space-items').replaceChildren(...rows.length ? rows : [el('li', () => t('spaceEmpty'), 'hint')]);
    const deleted = trash.map(item => {
        const restore = document.createElement('form');
        restore.className = 'space-inline-form';
        const rename = el('label');
        const field = document.createElement('input');
        field.maxLength = 200;
        rename.append(el('span', () => t('spaceRestoreName')), field);
        const submit = el('button', () => t('spaceRestore')) as HTMLButtonElement;
        submit.type = 'submit';
        restore.append(rename, submit);
        restore.addEventListener('submit', event => {
            event.preventDefault();
            const name = field.value.trim();
            manageSpace(signal => api(base + '/trash/' + item.id + '/restore', {}, jsonRequest(name ? { name } : {}, 'POST', signal)));
        });
        const purge = manager ? [spaceButton('spacePurge', () => {
            if (window.confirm(t('spacePurgeConfirm'))) manageSpace(signal => api(base + '/trash/' + item.id, {}, { method: 'DELETE', signal }));
        })] : [];
        return spaceItemRow(el('span', item.name), restore, ...purge);
    });
    element('space-trash-items').replaceChildren(...deleted.length ? deleted : [el('li', () => t('spaceEmpty'), 'hint')]);
}

function normalizeMarkdown(text: string) {
    return text.replace(/\r\n?/g, '\n');
}

function readDraft(document: SpaceDocument, value: string) {
    if (normalizeMarkdown(document.markdown) === value) return document.markdown;
    const ending = document.markdown.match(/\r\n|\n|\r/)?.[0] ?? '\n';
    return ending === '\n' ? value : value.replaceAll('\n', ending);
}

function spaceDraftKey(document: SpaceDocument) {
    return document.spaceId + '/' + document.id + '/' + document.version.id;
}

function displaySpacePdfPage(pages: NonNullable<SpaceDocument['pdfPages']>, number: number) {
    const page = pages[number - 1];
    element<HTMLTextAreaElement>('space-markdown').value = page.text;
    report('space-pdf-status', page.truncated ? 'spacePdfTruncated' : !page.text.trim() ? 'spacePdfNoText' : '');
}

function cellKey(cell: Cell) { return `${cell.row}/${cell.column}`; }

function cellLabel(cell: Cell) { return `${t('spaceCsvRow')} ${cell.row} · ${t('spaceCsvColumn')} ${cell.column}`; }

function csvCellButton(cell: Cell) {
    return element('space-csv-table').querySelector<HTMLButtonElement>(`[data-cell="${cellKey(cell)}"]`);
}

function showSpaceCsvRow(row: number) {
    if (!spaceDocument?.csvRows || !spaceCsv || !spaceDocument.csvRows.length) return;
    const safe = Math.min(spaceDocument.csvRows.length, Math.max(1, Number.isInteger(row) ? row : 1));
    updateSpaceCsvCell(spaceDocument, { row: safe, column: 1 });
}

function updateSpaceCsvCell(document: SpaceDocument, cell: Cell) {
    if (!spaceCsv || document !== spaceDocument) return;
    spaceCsv = { ...spaceCsv, cell, start: Math.floor((cell.row - 1) / csvRowsPerPage) * csvRowsPerPage };
    renderSpaceCsv(document);
    const destination = new URL(location.href);
    destination.searchParams.set('revision', document.version.id);
    destination.searchParams.set('row', String(cell.row));
    destination.searchParams.set('column', String(cell.column));
    destination.searchParams.delete('line');
    history.replaceState(history.state, '', destination);
}

function renderSpaceCsv(document: SpaceDocument) {
    if (!spaceCsv || !document.csvRows) return;
    const { start, cell, writable } = spaceCsv;
    const rows = document.csvRows.slice(start, start + csvRowsPerPage);
    const drafts = spaceCsvDrafts.get(spaceDraftKey(document));
    const columns = rows.reduce((count, row) => Math.max(count, row.length), 0);
    const table = element<HTMLTableElement>('space-csv-table');
    const header = table.createTHead();
    header.replaceChildren();
    const headings = header.insertRow();
    for (let column = 0; column <= columns; column++) {
        const label = el('th', column ? String(column) : t('spaceCsvRow')) as HTMLTableCellElement;
        label.scope = 'col';
        headings.append(label);
    }
    const body = table.tBodies[0] ?? table.createTBody();
    body.replaceChildren();
    rows.forEach((values, offset) => {
        const row = start + offset + 1;
        const line = body.insertRow();
        const label = el('th', String(row)) as HTMLTableCellElement;
        label.scope = 'row';
        line.append(label);
        values.forEach((original, index) => {
            const position = { row, column: index + 1 };
            const key = cellKey(position);
            const button = el('button', drafts?.get(key)?.value ?? original) as HTMLButtonElement;
            button.type = 'button';
            button.dataset.cell = key;
            button.setAttribute('aria-label', cellLabel(position));
            button.setAttribute('aria-pressed', String(cell !== undefined && cellKey(cell) === key));
            button.addEventListener('click', () => {
                updateSpaceCsvCell(document, position);
                if (writable) element<HTMLTextAreaElement>('space-csv-cell').focus({ preventScroll: true });
                else csvCellButton(position)?.focus({ preventScroll: true });
            });
            line.insertCell().append(button);
        });
    });
    const rowInput = input('space-csv-row');
    rowInput.disabled = !rows.length;
    rowInput.max = String(document.csvRows.length);
    rowInput.value = String(cell?.row ?? 1);
    element<HTMLButtonElement>('space-csv-previous').disabled = start === 0;
    element<HTMLButtonElement>('space-csv-next').disabled = start + csvRowsPerPage >= document.csvRows.length;
    element('space-csv-empty').hidden = rows.length > 0;
    table.hidden = !rows.length;
    element('space-csv-cell-field').hidden = !cell;
    const field = element<HTMLTextAreaElement>('space-csv-cell');
    field.readOnly = !writable;
    field.value = cell ? (drafts?.get(cellKey(cell))?.value ?? document.csvRows[cell.row - 1][cell.column - 1]) : '';
    element('space-csv-cell-label').textContent = cell ? cellLabel(cell) : '';
    element<HTMLButtonElement>('space-save').disabled = writable && !drafts?.size;
}

function renderSpaceDocument(result: SpaceDocument, versions: SpaceDocument['version'][], writable: boolean, line?: number, page?: number, cell?: Cell) {
    spaceDocument = result;
    element('space-reader').hidden = false;
    element('space-document-name').textContent = result.name;
    const choices = versions.some(version => version.id === result.version.id) ? versions : [...versions, result.version];
    select('space-version').replaceChildren(...choices.map(version =>
        new Option('#' + version.ordinal + ' · ' + new Date(version.createdAt).toLocaleString(language), version.id)));
    select('space-version').value = result.version.id;
    const field = element<HTMLTextAreaElement>('space-markdown');
    const current = result.version.id === result.versionId;
    field.readOnly = Boolean(result.pdfPages || result.csvRows) || !writable || !current;
    const draft = spaceDrafts.get(spaceDraftKey(result));
    element('space-pdf-page-field').hidden = !result.pdfPages;
    element('space-document-text-field').hidden = Boolean(result.csvRows);
    element('space-csv-grid').hidden = !result.csvRows;
    spaceCsv = undefined;
    const pageControl = select('space-pdf-page');
    const textLabel = element('space-document-text-label');
    const exportButton = element('space-export');
    textLabel.dataset.text = result.pdfPages ? 'spacePdfText' : 'spaceMarkdown';
    exportButton.dataset.text = result.pdfPages ? 'spaceDownloadPdf' : result.csvRows ? 'spaceDownloadCsv' : 'downloadMarkdown';
    textLabel.textContent = t(textLabel.dataset.text);
    exportButton.textContent = t(exportButton.dataset.text);
    if (result.pdfPages) {
        const selected = page && Number.isInteger(page) && result.pdfPages[page - 1] ? page : 1;
        pageControl.replaceChildren(...result.pdfPages.map((_, index) => new Option(String(index + 1), String(index + 1))));
        pageControl.value = String(selected);
        displaySpacePdfPage(result.pdfPages, selected);
    } else {
        pageControl.replaceChildren();
        report('space-pdf-status');
        field.value = (!field.readOnly ? draft : undefined) ?? result.markdown;
    }
    element<HTMLButtonElement>('space-save').disabled = false;
    if (result.csvRows) {
        const chosen = cell && result.csvRows[cell.row - 1]?.[cell.column - 1] !== undefined ? cell
            : result.csvRows.length ? { row: 1, column: 1 } : undefined;
        spaceCsv = { cell: chosen, start: chosen ? Math.floor((chosen.row - 1) / csvRowsPerPage) * csvRowsPerPage : 0, writable: writable && current };
        renderSpaceCsv(result);
        if (cell && chosen === cell) csvCellButton(cell)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    const earlierDrafts = [...spaceDrafts].filter(([key]) => key.startsWith(result.spaceId + '/' + result.id + '/'));
    const keptCsv = [...spaceCsvDrafts].find(([key, values]) => values.size && key.startsWith(result.spaceId + '/' + result.id + '/')
        && (!writable || !current || key !== spaceDraftKey(result)))?.[1];
    const retained = keptCsv ? [...keptCsv.values()].map(edit => cellLabel(edit) + '\n' + edit.value).join('\n\n')
        : field.readOnly && draft !== undefined ? draft : earlierDrafts.find(([key]) => key !== spaceDraftKey(result))?.[1];
    element('space-retained-draft').hidden = retained === undefined;
    element<HTMLTextAreaElement>('space-draft-content').value = retained ?? '';
    element('space-save').hidden = result.csvRows ? !spaceCsv?.writable || !result.csvRows.length : field.readOnly;
    element('space-generate-revision').hidden = field.readOnly;
    element('space-restore-version').hidden = !writable || current;
    if (!result.csvRows && line && Number.isSafeInteger(line) && line > 0) {
        const lines = field.value.split('\n');
        const start = lines.slice(0, line - 1).reduce((offset, value) => offset + value.length + 1, 0);
        if (line <= lines.length) {
            field.focus();
            field.setSelectionRange(start, start + lines[line - 1].length);
            field.scrollTop = Math.max(0, line - 3) * (parseFloat(getComputedStyle(field).lineHeight) || 20);
        }
    }
}

function loadSpaces(params: URLSearchParams) {
    const id = params.get('space');
    const folder = params.get('folder');
    const item = params.get('item');
    const revision = params.get('revision');
    if (spaceSettingsId && spaceSettingsId !== id) element<HTMLDialogElement>('space-settings').close();
    if (spaceMove && spaceMove.spaceId !== id) element<HTMLDialogElement>('space-move').close();
    if (spaceImport && spaceImport.spaceId !== id) element<HTMLDialogElement>('space-import').close();
    const query = params.get('q')?.trim() ?? '';
    const previousId = spaceState?.space.id;
    const previousFolder = spaceState?.folder;
    const previousDocument = spaceDocument;
    element('space-content').hidden = true;
    spaceState = undefined;
    spaceDocument = undefined;
    spaceCsv = undefined;
    if (previousId !== id || previousFolder !== folder) {
        controllers.get('space-action')?.abort();
        element<HTMLDetailsElement>('space-trash').open = false;
    }
    if (previousId !== id) {
        for (const key of ['space-link-snapshots', 'space-detached']) controllers.get(key)?.abort();
        select('space-link-snapshot').replaceChildren();
        element<HTMLDetailsElement>('space-detached').open = false;
        element('space-detached-items').replaceChildren();
    }
    if (previousId !== id || previousDocument?.id !== item || previousDocument?.version.id !== revision) {
        element('space-reader').hidden = true;
        report('space-document-status');
    }
    input('space-search').value = query;
    void run('spaces', async signal => {
        const list = await api<Space[]>('/spaces', {}, { signal });
        if (!isUuid(id)) return { list };
        const base = '/spaces/' + id;
        const parent = isUuid(folder) ? folder : null;
        const space = await api<SpaceDetail>(base, {}, { signal });
        const [items, trash, doc] = await Promise.all([
            query ? api<SpaceItem[]>(base + '/documents/search', { q: query }, { signal })
                .then(found => found.map(item => ({ ...item, kind: item.mediaType === 'application/pdf' ? 'PDF' as const
                    : item.mediaType === 'text/csv' ? 'CSV' as const : 'MARKDOWN' as const })))
                : api<SpaceItem[]>(base + '/items', parent ? { parentId: parent } : {}, { signal }),
            writableSpace(space) ? api<SpaceTrashItem[]>(base + '/trash', {}, { signal }) : [],
            isUuid(item) ? Promise.all([
                api<SpaceDocument>(base + '/documents/' + item + (isUuid(revision) ? '/versions/' + revision : ''), {}, { signal }),
                api<SpaceDocument['version'][]>(base + '/documents/' + item + '/versions', {}, { signal })
            ]) : undefined
        ]);
        return { list, state: { space, folder: parent, items, trash }, doc };
    }, data => {
        report('spaces-status');
        const rows = data.list.map(space => {
            const link = spaceLinkNode(space.name, space.id);
            if (space.id === id) link.setAttribute('aria-current', 'page');
            return spaceItemRow(link);
        });
        element('space-list').replaceChildren(...rows.length ? rows : [el('li', () => t('spaceEmpty'), 'hint')]);
        spaceState = data.state;
        element('space-reader').hidden = true;
        if (data.state) {
            renderSpace(data.state);
            const cell = params.has('row') && params.has('column') ? { row: Number(params.get('row')), column: Number(params.get('column')) } : undefined;
            if (data.doc) renderSpaceDocument(...data.doc, writableSpace(data.state.space), Number(params.get('line')), Number(params.get('page')), cell);
        }
    });
}

function saveSpaceDocument(restore: boolean) {
    const document = spaceDocument;
    const state = spaceState;
    if (!document || !state || !writableSpace(state.space)) return;
    const path = '/spaces/' + document.spaceId + '/documents/' + document.id;
    const field = element<HTMLTextAreaElement>('space-markdown');
    const draftKey = spaceDraftKey(document);
    const csv = !restore && Boolean(document.csvRows);
    const cell = spaceCsv?.cell;
    const edits = csv ? [...(spaceCsvDrafts.get(draftKey)?.values() ?? [])] : [];
    if (!restore && (csv ? !spaceCsv?.writable || !edits.length : field.readOnly)) return;
    const payload = restore ? { baseVersionId: document.versionId, restoreVersionId: document.version.id }
        : csv ? { baseVersionId: document.version.id, edits } : { baseVersionId: document.version.id, markdown: readDraft(document, field.value) };
    const route = path + (restore ? '/restore' : csv ? '/cells' : '');
    const method = restore ? 'POST' : csv ? 'PATCH' : 'PUT';
    const submitted = field.value;
    const id = route + JSON.stringify(payload);
    if (spaceSubmission?.input !== id) spaceSubmission = { input: id, key: crypto.randomUUID() };
    const key = spaceSubmission.key;
    manageSpace(signal => api<SpaceDocument>(route, {}, jsonRequest({ ...payload, key }, method, signal)),
        () => {
            if (csv) {
                const drafts = spaceCsvDrafts.get(draftKey);
                for (const edit of edits) if (drafts?.get(cellKey(edit)) === edit) drafts.delete(cellKey(edit));
                if (!drafts?.size) spaceCsvDrafts.delete(draftKey);
            } else if (!restore && field.value === submitted) spaceDrafts.delete(draftKey);
            spaceSubmission = undefined;
            openSpace(document.spaceId, { item: document.id, ...(state.folder ? { folder: state.folder } : {}),
                ...(cell ? { row: String(cell.row), column: String(cell.column) } : {}) });
            report('space-action-status', 'spaceSaved', '', 'success');
        });
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
    const snapshot = destination === 'graph' ? params.get('snapshotId') ?? undefined : undefined;
    if (snapshot !== graphSnapshot) {
        graphSnapshot = snapshot;
        controllers.get('graph')?.abort();
        controllers.get('locate')?.abort();
        graphView = undefined;
        flowView = undefined;
        element('graph-results').replaceChildren();
        report('graph-status');
        report('locate-status');
        if (element<HTMLDialogElement>('source-dialog').open) element<HTMLDialogElement>('source-dialog').close();
    }
    if (previous === 'admin' && destination !== 'admin') input('provider-key').value = '';
    if (selected !== project || view !== destination) {
        if (previous === 'wiki') wikiReader.suspend();
        if (previous === 'overview') architectureReader?.suspend();
        if (previous === 'ask' && destination !== 'ask') closeAskAttachment();
        if (previous === 'spaces' && destination !== 'spaces') {
            for (const dialog of ['space-generation', 'space-settings', 'space-move', 'space-import']) element<HTMLDialogElement>(dialog).close();
        }
        if (previous === 'search' && destination !== 'search') knowledgeOptionsLoaded = false;
        for (const [key, controller] of controllers) {
            if (key === 'repositories' || (key === 'benchmark' && previous === destination)) continue;
            controller.abort();
            if (notes.get(`${key}-status`)?.key === 'load') report(`${key}-status`);
        }
        if (selected !== project) {
            flowView = undefined;
            graphView = undefined;
            select('knowledge-sources').selectedIndex = -1;
            resetSearchResults();
            report('search-status');
            for (const panel of ['graph', 'evidence']) {
                element(`${panel}-results`).replaceChildren();
                report(`${panel}-status`);
            }
            report('locate-status');
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
    renderGraphScope();
    for (const name of views) element(`view-${name}`).hidden = name !== view;
    for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a[data-view]')) {
        if (link.dataset.view === (view === 'overview' ? 'repositories' : view)) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
        link.href = route(link.dataset.view as View, selected);
    }
    element('current-view').textContent = t(view);
    closeMenu();
    renderProjects();
    if (view === 'search') {
        restoreKnowledgeSearch(params);
        element('next').hidden = !nextPage;
    }
    if (previous !== view) {
        const heading = element(`${view}-title`);
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
    }
    if (connected && view === 'overview') loadOverview();
    if (connected && view === 'spaces') loadSpaces(params);
    if (connected && view === 'ask') loadAsk(params);
    if (connected && view === 'evidence') loadEvidenceSnapshots(params.get('snapshotId'));
    if (connected && view === 'change-review') {
        syncChangeSource();
        loadChangeReview(params.get('snapshot'), params.get('run'));
    }
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
        loadWiki(params);
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
            locate(file, line, selected, input('locate-archive-entry').value, params.get('symbol') ?? undefined);
        } else if (target) {
            input('target').value = target;
            trace();
        }
    }
}

function resultButton(label: string, action: () => void) {
    const control = el('button', () => t(label)) as HTMLButtonElement;
    control.type = 'button';
    control.addEventListener('click', action);
    return control;
}

function repositoryName(project: DashboardProject) {
    return project.archiveName || project.projectName || project.projectId;
}

function workbenchIcon(name: string, className = '') {
    const icon = el('span', '', `nav-icon icon-${name} ${className}`);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function repositoryStatus(project: DashboardProject) {
    const status = project.indexStatus;
    const [label, icon] = {
        done: ['repositoryReady', 'ready'], running: ['repositoryIndexing', 'indexing'],
        partial: ['repositoryPartial', 'partial'], error: ['indexError', 'partial'], idle: ['repositoryIdle', 'clock']
    }[status];
    const badge = el('span', '', 'repository-status');
    badge.dataset.status = status;
    badge.append(workbenchIcon(icon), t(label));
    return badge;
}

function repositoryTime(indexedAt: string) {
    const time = document.createElement('time');
    time.dateTime = indexedAt;
    const date = new Date(indexedAt);
    time.textContent = date.toDateString() === new Date().toDateString()
        ? date.toLocaleTimeString(language, { timeStyle: 'short' })
        : date.toLocaleDateString(language, { dateStyle: 'medium' });
    time.title = date.toLocaleString(language);
    return time;
}

function renderWorkspaceSummary() {
    const summary = element('workspace-summary');
    const previous = new Map([...summary.querySelectorAll<HTMLElement>('[data-count-key]')].map(node => [node.dataset.countKey, node]));
    const animate = connected && view === 'repositories';
    const total = projects.length;
    const ready = projects.filter(project => project.indexStatus === 'done').length;
    const percent = new Intl.NumberFormat(language, { style: 'percent' });
    const readiness = total ? ready / total : 0;
    const ring = el('span', '', 'summary-ring');
    ring.setAttribute('aria-hidden', 'true');
    ring.style.setProperty('--readiness', `${readiness * 100}%`);
    const bars = (field: 'fileCount' | 'nodeCount', className: string) => {
        const chart = el('span', '', `summary-bars ${className}`);
        chart.setAttribute('aria-hidden', 'true');
        // Aggregate neighboring repositories when the graphic has more than eight values.
        const values = Array.from({ length: Math.min(8, total) }, () => 0);
        projects.forEach((project, index) => {
            values[Math.floor(index * values.length / total)] += project[field];
        });
        const max = Math.max(1, ...values);
        for (const count of values) {
            const bar = el('i');
            bar.style.height = `${Math.max(4, 44 * count / max)}px`;
            chart.append(bar);
        }
        return chart;
    };
    const cell = (label: string, value: number | null, detail: string, graphic: HTMLElement, format = formatNumber) => {
        const group = el('div', '', 'summary-cell');
        const count = el('dd', '', 'summary-value');
        const metric = value === null ? el('strong', '—') : previous.get(label) ?? el('strong');
        if (value !== null) {
            metric.dataset.countKey = label;
            updateCount(metric, value, animate, format);
        }
        count.append(metric, graphic);
        group.append(el('dt', t(label)), count, el('dd', detail, 'summary-detail'));
        return group;
    };
    summary.replaceChildren(
        cell('workspaceRepositories', total, t('workspaceSources'), workbenchIcon('repo', 'summary-icon')),
        cell('workspaceFiles', projects.reduce((sum, project) => sum + project.fileCount, 0), t('workspaceAcrossProjects'), bars('fileCount', 'file-bars')),
        cell('workspaceSymbols', projects.reduce((sum, project) => sum + project.nodeCount, 0), t('workspaceSnapshot'), bars('nodeCount', 'symbol-bars')),
        cell('workspaceReadiness', total ? readiness * 100 : null, `${formatNumber(ready)} / ${formatNumber(total)} ${t('workspaceReady')}`, ring,
            value => percent.format(value / 100))
    );

    const completed = projects.filter(project => project.indexedAt)
        .sort((a, b) => b.indexedAt.localeCompare(a.indexedAt)).slice(0, 3);
    element('repository-activity').replaceChildren(...(completed.length ? completed.map(project => {
        const item = el('a', '', 'repo-event') as HTMLAnchorElement;
        item.href = route('overview', project.projectId);
        item.dataset.openRepository = project.projectId;
        const text = el('span');
        text.append(el('strong', repositoryName(project)), el('small', t('workspaceUpdated')));
        item.append(workbenchIcon('clock'), text, repositoryTime(project.indexedAt));
        return item;
    }) : [el('p', t('workspaceNoActivity'), 'workspace-empty')]));

    const byLanguage = new Map<string, number>();
    for (const project of projects) {
        const name = project.mainLanguage ?? 'workspaceUnknownLanguage';
        byLanguage.set(name, (byLanguage.get(name) ?? 0) + 1);
    }
    const distribution = [...byLanguage].sort(([a, ac], [b, bc]) => bc - ac || t(a).localeCompare(t(b), language));
    const graph = el('div', '', 'workspace-lang-bar');
    graph.setAttribute('aria-hidden', 'true');
    const legend = el('ul', '', 'workspace-lang-legend');
    for (const [name, count] of distribution) {
        const bar = el('i');
        bar.style.flexGrow = String(count);
        graph.append(bar);
        const item = el('li');
        item.append(el('i'), el('span', t(name)), el('span', percent.format(count / total)));
        legend.append(item);
    }
    element('repository-languages').replaceChildren(...(total
        ? [graph, legend] : [el('p', t('workspaceNoLanguages'), 'workspace-empty')]));
}

function renderProjects() {
    const projectControl = select('project');
    projectControl.replaceChildren(new Option(t('choose'), ''), ...projects.map(project =>
        new Option(repositoryName(project), project.projectId)));
    projectControl.value = selected;
    if (view === 'search') renderKnowledgeSources();
    renderWorkspaceSummary();
    renderRepositoryList();
}

function renderRepositoryList() {
    const query = input('repo-filter').value.trim().toLocaleLowerCase(language);
    const source = select('repo-kind').value;
    const matching = projects.filter(project =>
        (source === 'all' || source === (project.git ? 'git' : project.assetId ? 'archive' : 'local')) &&
        [repositoryName(project), project.git?.url ?? project.projectRoot, project.projectId, t(project.mainLanguage ?? '')]
            .some(value => value.toLocaleLowerCase(language).includes(query)));
    for (const control of document.querySelectorAll<HTMLButtonElement>('[data-repo-status]')) {
        const status = control.dataset.repoStatus;
        control.setAttribute('aria-pressed', String(status === repositoryFilter));
        updateCount(control.querySelector('small')!, status === 'all' ? matching.length
            : matching.filter(project => project.indexStatus === status).length, connected && view === 'repositories');
    }
    const filtered = matching.filter(project => repositoryFilter === 'all' || project.indexStatus === repositoryFilter)
        .sort((a, b) => b.indexedAt.localeCompare(a.indexedAt) || repositoryName(a).localeCompare(repositoryName(b), language));
    const empty = element('repository-empty');
    empty.hidden = filtered.length > 0;
    empty.textContent = t(projects.length ? 'repositoryFilterEmpty' : 'emptyRepos');
    element('repository-list').replaceChildren(...filtered.map(repositoryRow));
}

let projectTrashState: ProjectTrash | undefined;
let projectTrashTimer: ReturnType<typeof setTimeout> | undefined;
let projectAction: { fingerprint: string; key: string; revision?: number } | undefined;

function renderProjectTrash() {
    const data = projectTrashState;
    if (!data) return;
    const rows = data.projects.map(item => {
        const name = el('span', item.name);
        const wait = item.state === 'TRASHED' && (item.purgeAfter ?? 0) > Date.now();
        const status = item.state === 'PURGING' ? t('projectPurging')
            : wait ? t('projectRetentionUntil') + ' · ' + new Date(item.purgeAfter!).toLocaleString(language) : '';
        if (status) name.append(el('small', ' · ' + status, 'kind'));
        if (item.state !== 'TRASHED') return spaceItemRow(name);
        const restore = resultButton('spaceRestore', () => changeProjectLifecycle(item.projectId, 'restore', item.revision));
        const purge = resultButton('spacePurge', () => {
            if (window.confirm(t('projectPurgeConfirm'))) changeProjectLifecycle(item.projectId, 'purge', item.revision);
        });
        purge.disabled = wait;
        return spaceItemRow(name, restore, purge);
    });
    element('project-trash-list').replaceChildren(...rows.length ? rows : [el('li', () => t('spaceEmpty'), 'hint')]);
    element('project-trash-next').hidden = !data.hasMore;
}

function loadProjectTrash(append = false) {
    clearTimeout(projectTrashTimer);
    if (!connected || view !== 'repositories' || !element<HTMLDetailsElement>('project-trash').open) return;
    const offset = append ? projectTrashState?.projects.length ?? 0 : 0;
    void run('project-trash', signal => api<ProjectTrash>('/projects/trash', { offset: String(offset), limit: '50' }, { signal }), result => {
        projectTrashState = { ...result, projects: [...(offset ? projectTrashState?.projects ?? [] : []), ...result.projects] };
        renderProjectTrash();
        report('project-trash-status');
        if (projectTrashState.projects.some(project => project.state === 'PURGING')) projectTrashTimer = setTimeout(loadProjectTrash, 2500);
    });
}

function changeProjectLifecycle(id: string, action: 'trash' | 'restore' | 'purge', revision?: number) {
    if (controllers.has('project-lifecycle')) return;
    const path = '/projects/' + id + '/lifecycle';
    const fingerprint = JSON.stringify([id, action, revision]);
    if (projectAction?.fingerprint !== fingerprint) projectAction = { fingerprint, key: crypto.randomUUID(), revision };
    const attempt = projectAction;
    const status = action === 'trash' ? 'repositories' : 'project-lifecycle';
    if (controllers.has(status)) return;
    void run(status, async signal => {
        attempt.revision ??= (await api<ProjectLifecycle>(path, {}, { signal })).revision;
        const init = jsonRequest({ action, revision: attempt.revision }, 'POST', signal);
        const headers = new Headers(init.headers);
        headers.set('Idempotency-Key', attempt.key);
        try { return await api<ProjectLifecycle>(path, {}, { ...init, headers }); }
        catch (error) {
            if (error instanceof RequestError && ['PROJECT_LIFECYCLE_CHANGED', 'PROJECT_LIFECYCLE_STATE'].includes(error.code)) projectAction = undefined;
            throw error;
        }
    }, state => {
        projectAction = undefined;
        if (action === 'trash' && selected === id) navigate('repositories', '');
        if (action === 'trash') element<HTMLDetailsElement>('project-trash').open = true;
        report('project-lifecycle-status', action === 'trash' ? 'projectTrashMoved' : action === 'restore' ? 'projectTrashRestored'
            : state.state === 'PURGING' ? 'projectPurging' : 'projectPurged', '', 'success');
        loadProjectTrash();
        void refreshProjects();
    });
}

function repositoryRow(project: DashboardProject) {
    const name = repositoryName(project);
    const row = el('tr');
    row.classList.toggle('current', selected === project.projectId);
    const identity = el('th', '', 'repo-identity');
    identity.setAttribute('scope', 'row');
    const group = el('div');
    const text = el('div');
    const link = el('a', name, 'repository-name') as HTMLAnchorElement;
    link.href = route('overview', project.projectId);
    link.dataset.openRepository = project.projectId;
    const path = el('span', project.git ? project.git.url + ' · ' + project.git.branch : project.archiveName ? t('assetsArchive') : project.projectRoot, 'repo-path mono');
    path.title = path.textContent;
    text.append(link, path);
    if (project.mainLanguage || project.indexedAt) {
        const metadata = el('span', project.mainLanguage ? t(project.mainLanguage) : '', 'repo-mobile-meta');
        if (project.indexedAt) metadata.append(repositoryTime(project.indexedAt));
        text.append(metadata);
    }
    const glyph = workbenchIcon(project.assetId ? 'box' : 'repo');
    const tile = el('span', '', 'repo-tile');
    tile.dataset.color = String(parseInt(project.projectId.slice(-2), 16) % 5);
    tile.append(glyph);
    group.append(tile, text);
    identity.append(group);

    const mainLanguage = el('td', '', 'repo-language');
    if (project.mainLanguage) {
        const label = el('span', t(project.mainLanguage), 'repo-language-label');
        label.dataset.language = project.mainLanguage;
        mainLanguage.append(label);
    } else mainLanguage.textContent = '—';
    const status = el('td');
    status.append(repositoryStatus(project));
    const updated = el('td', '', 'repo-updated mono');
    updated.append(project.indexedAt ? repositoryTime(project.indexedAt) : '—');
    const actions = el('td', '', 'repo-actions');
    const menu = el('details', '', 'action-popover');
    menu.dataset.dropdown = '';
    const trigger = el('summary', '···', 'icon-button');
    trigger.setAttribute('aria-label', t('repositoryActions') + ' · ' + name);
    const items = el('div', '', 'popover-items');
    items.append(resultButton('openSearch', () => {
        select('search-scope').value = 'current';
        navigate('search', project.projectId);
    }));
    if (account?.role === 'ADMIN' && !project.git && !project.assetId) {
        items.append(resultButton('indexRepository', () => {
            input('directory').value = project.projectRoot;
            openRepositoryDialog('local', trigger);
        }));
    }
    if (project.canManage ?? account?.role === 'ADMIN') {
        items.append(resultButton('projectTrashMove', () => {
            if (window.confirm(t('projectTrashConfirm'))) changeProjectLifecycle(project.projectId, 'trash');
        }));
    }
    menu.append(trigger, items);
    actions.append(menu);
    row.append(identity, mainLanguage, status, updated, actions);
    return row;
}

function openRepositoryDialog(source: RepositorySource, opener = element('connect-repository')) {
    if (account?.role !== 'ADMIN') return;
    repositoryDialogOpener = opener;
    const panel = { local: 'local-index', archive: 'archive-upload', git: 'git-connect' }[source];
    if (repositoryTabs.active === panel) {
        if (source === 'git') void loadGitConnections();
    } else repositoryTabs.select(panel);
    element<HTMLDialogElement>('index-section').showModal();
    element(source === 'local' ? 'directory' : source === 'archive' ? 'archive-file' : 'git-connection').focus();
}

function renderGitConnections(selectedId = '') {
    const control = select('git-connection');
    control.replaceChildren(new Option(t('gitNewConnection'), ''), ...gitConnections.filter(item => item.enabled)
        .map(item => new Option(item.name + ' · ' + item.url, item.id)));
    control.value = gitConnections.some(item => item.enabled && item.id === selectedId) ? selectedId : '';
    updateGitConnectionForm();
}

function updateGitConnectionForm() {
    const adding = !select('git-connection').value;
    element('git-new-connection').hidden = !adding;
    for (const id of ['git-connection-name', 'git-url', 'git-username', 'git-token']) input(id).disabled = !adding;
    select('git-adapter').disabled = !adding;
    if (!adding) input('git-token').value = '';
}

function loadGitConnections() {
    return run('git-connections', signal => api<GitConnection[]>('/git/connections', {}, { signal }), connections => {
        gitConnections = connections;
        renderGitConnections(select('git-connection').value);
        report('git-connections-status');
    });
}

function connectGit() {
    if (controllers.has('git-connect')) return;
    const control = select('git-connection');
    const branch = input('git-branch').value.trim();
    const name = input('git-connection-name').value.trim();
    const url = input('git-url').value.trim();
    const adapter = select('git-adapter').value;
    const username = input('git-username').value;
    const token = input('git-token').value;
    input('git-token').value = '';
    const submit = element<HTMLFormElement>('git-connect-form').querySelector('button')!;
    submit.disabled = true;
    void run('git-connect', async signal => {
        let connectionId = control.value;
        if (!connectionId) {
            const connection = await api<GitConnection>('/git/connections', {}, jsonRequest({
                name, url, ...(adapter ? { adapter } : {}), ...(username ? { username } : {}), ...(token ? { token } : {})
            }, 'POST', signal));
            connectionId = connection.id;
            if (!signal.aborted) {
                gitConnections = [...gitConnections, connection];
                renderGitConnections(connectionId);
            }
        }
        await api('/git/connections/' + connectionId + '/test', {}, jsonRequest({ branch }, 'POST', signal));
        const repository = await api<GitRepository>('/git/repositories', {}, jsonRequest({ connectionId, branch }, 'POST', signal));
        await api<GitSync>('/git/repositories/' + repository.projectId + '/sync', {}, jsonRequest({}, 'POST', signal));
        await refreshProjects();
        return repository;
    }, repository => {
        report('git-connect-status');
        element<HTMLDialogElement>('index-section').close();
        navigate('overview', repository.projectId);
    }).finally(() => { submit.disabled = false; });
}

function readGitOverview(projectId: string, signal: AbortSignal) {
    return Promise.all([
        api<GitRepository>('/git/repositories/' + projectId, {}, { signal }),
        api<WikiSnapshot[]>('/knowledge-snapshots', { projectId, limit: '1' }, { signal })
    ]).then(([repository, snapshots]) => ({ repository, published: snapshots[0] }));
}

function renderWeekdays(id: string, days: number[]) {
    const choices = [1, 2, 3, 4, 5, 6, 0].map(day => {
        const marker = document.createElement('input');
        marker.type = 'checkbox';
        marker.value = String(day);
        marker.checked = days.includes(day);
        const label = el('label', '', 'check');
        const weekday = new Date(Date.UTC(2024, 0, 7 + day));
        label.append(marker, el('span', () => new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'UTC' }).format(weekday)));
        return label;
    });
    element(id).replaceChildren(...choices);
}

function syncGitScheduleFields() {
    const mode = select('git-schedule-mode').value;
    const calendar = mode === 'calendar';
    element('git-interval-field').hidden = mode !== 'interval';
    element('git-calendar-fields').hidden = !calendar;
    for (const [field, visible] of [['git-interval', mode === 'interval'], ['git-time-zone', calendar], ['git-local-time', calendar]] as const) {
        input(field).disabled = !visible;
        input(field).required = visible;
    }
    const zones = element('git-time-zones');
    if (calendar && !zones.children.length) zones.replaceChildren(...['UTC', ...Intl.supportedValuesOf('timeZone')].map(zone => new Option(zone, zone)));
}

function renderGitOverview(state: NonNullable<typeof gitOverview>, updateSettings: boolean) {
    const { repository: data, published } = state;
    const active = data.latestSync && ['QUEUED', 'RUNNING', 'PAUSED'].includes(data.latestSync.status);
    element('git-overview').hidden = false;
    const timezone = data.automation.calendar?.timeZone;
    const next = data.automation.nextAt ? new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone })
        .format(data.automation.nextAt) + (timezone ? ' · ' + timezone : '') : null;
    const cells: [string, string | null][] = [
        ['gitBranch', data.branch], ['gitIndexedCommit', data.indexedCommit], ['gitSyncCommit', data.latestSync?.commit ?? null], ['gitNextCheck', next]
    ];
    const fields = cells.flatMap(([label, value]) => value ? [el('dt', () => t(label)), el('dd', value, 'mono')] : []);
    element('git-overview-data').replaceChildren(...fields);
    const link = element<HTMLAnchorElement>('git-published');
    link.hidden = !published;
    if (published) link.href = route('wiki', data.projectId, { snapshotId: published.id });
    element('git-sync').hidden = !data.canEdit || !data.enabled || Boolean(active) || data.latestSync?.publicationStatus === 'PENDING';
    element('git-retry').hidden = !data.canEdit || !data.enabled || !data.latestSync || !['FAILED', 'CANCELLED'].includes(data.latestSync.status);
    element('git-cancel').hidden = !data.canManage || !active;
    element('git-automation-tab').hidden = !data.canManage;
    element('git-connection-tab').hidden = account?.role !== 'ADMIN';
    gitTabs.refresh();
    if (updateSettings) {
        select('git-schedule-mode').value = data.automation.calendar ? 'calendar' : data.automation.intervalMinutes ? 'interval' : 'off';
        input('git-interval').value = data.automation.intervalMinutes?.toString() ?? '';
        input('git-time-zone').value = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        input('git-local-time').value = data.automation.calendar?.localTime ?? '09:00';
        renderWeekdays('git-schedule-days', data.automation.calendar?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
        syncGitScheduleFields();
        input('git-events').checked = data.automation.eventEnabled;
        input('git-auto-publish').checked = data.automation.publishAfterSync;
    }
    if (!data.enabled) report('git-overview-status', 'GIT_CONNECTION_DISABLED', '', 'warning');
    else if (data.latestSync?.publicationStatus === 'FAILED' || data.latestSync?.wikiStatus === 'FAILED') {
        report('git-overview-status', 'gitPublicationFailed', () => diagnostic(data.latestSync?.publicationReason ?? ''), 'error');
    } else if (gitPublicationInProgress(data.latestSync)) {
        report('git-overview-status', 'gitPublicationPending');
    } else {
        const status = data.latestSync?.status;
        report('git-overview-status', status ?? 'gitIdle', () => diagnostic(data.latestSync?.reason ?? ''),
            status === 'FAILED' ? 'error' : status === 'COMPLETED' ? 'success' : undefined);
    }
}

function gitPublicationInProgress(latest: GitRepository['latestSync']) {
    return latest?.publicationStatus === 'PENDING' || latest?.wikiStatus === 'QUEUED' || latest?.wikiStatus === 'RUNNING';
}

function trackGitOverview(projectId: string) {
    element('git-overview').hidden = false;
    void run('git-overview', async signal => {
        for (let attempt = 0; attempt < 180 && !signal.aborted; attempt++) {
            const state = await readGitOverview(projectId, signal);
            if (signal.aborted) return;
            const update = gitOverview?.repository.projectId !== projectId
                || gitOverview.repository.automation.revision !== state.repository.automation.revision;
            const last = gitOverview?.repository.latestSync?.status;
            gitOverview = state;
            renderGitOverview(state, update);
            if (!gitPublicationInProgress(state.repository.latestSync)
                && (!state.repository.latestSync || !['RUNNING', 'QUEUED'].includes(state.repository.latestSync.status))) {
                if (last && ['RUNNING', 'QUEUED'].includes(last)) {
                    void refreshProjects();
                    void run('overview', overviewSignal => api<ProjectStats>(`/projects/${projectId}/stats`, {}, { signal: overviewSignal }), result => {
                        overview = result;
                        renderOverview(result);
                    });
                }
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 600));
        }
    }, () => {});
}

function gitAction(task: (repository: GitRepository, signal: AbortSignal) => Promise<unknown>) {
    const repository = gitOverview?.repository;
    if (!repository || controllers.has('git-action')) return;
    void run('git-action', signal => task(repository, signal), () => {
        report('git-action-status');
        if (view === 'overview' && selected === repository.projectId) trackGitOverview(repository.projectId);
    });
}

function loadGitSettings() {
    const repository = gitOverview?.repository;
    if (!repository) return;
    void run('git-connection-settings', signal => api<GitConnection>('/git/connections/' + repository.connectionId, {}, { signal }), connection => {
        gitSettings = connection;
        element<HTMLFormElement>('git-connection-form').reset();
        input('git-connection-enabled').checked = connection.enabled;
        element('git-event-path').textContent = connection.eventSecretConfigured ? '/api/v1/git/events/' + connection.id : '';
        const hosted = connection.hostedIdentity;
        const adapter = select('git-reconnect-adapter');
        adapter.value = hosted?.adapter ?? '';
        adapter.disabled = Boolean(hosted);
        element('git-reconnect-adapter-field').hidden = Boolean(hosted);
        input('git-reconnect-url').value = connection.url;
        const identity = element('git-hosted-identity');
        identity.hidden = !hosted;
        identity.textContent = hosted ? (hosted.adapter === 'GITHUB' ? 'GitHub' : 'GitLab') + ' · #' + hosted.upstreamId : '';
        const submit = element('git-reconnect-submit');
        submit.dataset.text = hosted ? 'gitReconnect' : 'gitVerifyIdentity';
        submit.textContent = t(submit.dataset.text);
        element('git-reconnect-form').hidden = false;
        element('git-disconnect').hidden = !connection.enabled && !connection.credentialConfigured && !connection.eventSecretConfigured;
        report('git-connection-settings-status');
    });
}

function refreshProjects() {
    return run('repositories', signal => api<DashboardProject[]>('/projects', { summary: 'true' }, { signal }), result => {
        projects = result;
        if (selected && !projects.some(project => project.projectId === selected)) {
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
    document.getElementById('overview-distributions')?.remove();
    element('overview-root').textContent = '';
    element('overview-title').textContent = t('overview');
    element('overview-state').hidden = true;
    element('overview-actions').hidden = true;
    gitOverview = undefined;
    gitSettings = undefined;
    gitTabs.select('git-status-panel');
    element<HTMLFormElement>('git-connection-form').reset();
    element('git-reconnect-form').hidden = true;
    element('git-disconnect').hidden = true;
    report('git-reconnect-status');
    report('git-disconnect-status');
    element('git-overview').hidden = true;
    element('archive-profile').hidden = true;
    element('archive-identity-form').hidden = true;
    report('archive-identity-status');
    element('profile-content').replaceChildren();
    report('profile-status');
    archiveOverview = undefined;
    if (!selected) {
        report('overview-status', 'pickFirst', '', 'warning');
        return;
    }
    const projectId = selected;
    const project = projects.find(item => item.projectId === projectId);
    if (project?.git) trackGitOverview(projectId);
    else if (project?.assetId) loadArchiveProfile(project.assetId);
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
    const show = connected && view === 'overview' && !!project && !project.assetId && !project.git && watchState !== undefined;
    element('watch-controls').hidden = !show;
    const control = element<HTMLButtonElement>('watch-toggle');
    control.hidden = !show || account?.role !== 'ADMIN';
    control.disabled = watchBusy;
    control.textContent = t(watchState ? 'watchStop' : 'watchStart');
    element('watch-state').textContent = show ? t(watchState ? 'watchActive' : 'watchIdle') : '';
}

function renderOverview(data: ProjectStats) {
    const content = element('overview-data');
    const previous = new Map([...content.querySelectorAll<HTMLElement>('[data-count-key]')].map(node => [node.dataset.countKey, node]));
    const project = projects.find(project => project.projectId === selected);
    element('overview-title').textContent = project ? repositoryName(project) : t('overview');
    element('overview-root').textContent = project?.git?.url ?? project?.archiveName ?? data.projectRoot;
    element('overview-state').hidden = !project;
    element('overview-state').replaceChildren(...(project ? [repositoryStatus(project)] : []));
    element('overview-updated').hidden = !project?.indexedAt;
    if (project?.indexedAt) element('overview-updated').replaceChildren(t('repositoryUpdated') + ' · ', repositoryTime(project.indexedAt));
    element('overview-actions').hidden = !data.projectRoot;
    if (!data.projectRoot) {
        report('overview-status', 'noResults');
        return;
    }
    report('overview-status');
    element('quality-panel').hidden = false;
    element('sbom-section').hidden = false;
    const hero = el('section', '', 'overview-hero');
    const metrics = el('dl', '', 'overview-metrics');
    for (const [name, count] of [
        ['allFiles', data.totalFiles], ['allUnits', data.totalUnits], ['allRelations', data.totalEdges],
        ['testUnits', data.testCount], ['entryPoints', data.entryPointCount]
    ] as const) {
        const metric = el('div');
        const value = previous.get(name) ?? el('dd');
        value.dataset.countKey = name;
        updateCount(value, count, true);
        metric.append(el('dt', t(name)), value);
        metrics.append(metric);
    }
    const distributions = el('div', '', 'distributions');
    for (const [name, distribution] of [
        ['languageBreakdown', data.languageDistribution], ['symbolKinds', data.kindDistribution],
        ['relationKinds', data.edgeKindDistribution], ['frameworks', data.frameworkDistribution]
    ] as const) {
        const rows = Object.entries(distribution).sort(([a, ac], [b, bc]) => bc - ac || t(a).localeCompare(t(b), language));
        if (!rows.length) continue;
        const panel = el('section', '', 'surface distribution');
        panel.append(el('h2', t(name)));
        const maximum = rows[0][1];
        for (const [label, count] of rows) {
            const row = el('div', '', 'distribution-row');
            const meter = el('meter') as HTMLMeterElement;
            meter.max = maximum;
            meter.value = count;
            meter.setAttribute('aria-label', t(label));
            row.append(el('span', t(label)), meter, el('strong', formatNumber(count)));
            panel.append(row);
        }
        distributions.append(panel);
    }
    hero.append(el('h2', t('indexOverview')), metrics);
    content.replaceChildren(hero);
    distributions.id = 'overview-distributions';
    document.getElementById(distributions.id)?.remove();
    element('overview-actions').after(distributions);
}

function resetQuality() {
    architectureReader?.clear();
    architectureReader = undefined;
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
            finding.ruleId, evidenceLocation(finding.filePath, finding.startLine, finding.endLine), t(finding.severity), finding.message
        ])), scanHistoryPager(projectId, paging, 'findingsPage', params));
    if (history.type === 'task') {
        const { task, observations: page } = history;
        const metadata = qualityTable(['scanTask', 'scanState', 'scanTime', 'scanAttempt', 'scanBatch'], [[
            task.id, status(task.status), date(task.updatedAt), String(task.attempt), task.batchId || '—'
        ]]);
        const detail = section('scanTask', metadata);
        if (task.assetId) detail.append(el('p', [t(task.assetAvailable ? 'scanAsset' : 'scanMissingAsset'), task.assetId].join(' · '), 'hint'));
        if (task.originalStatus) detail.append(el('p', [t('scanOriginalState'), status(task.originalStatus)].join(' · '), 'hint'));
        if (task.error) detail.append(el('p', diagnostic(task.error), 'hint'));
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
    if (scanRun.error) detail.append(el('p', diagnostic(scanRun.error), 'hint'));
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
            report('benchmark-status', 'benchmarkRetained', () => diagnostic(reason), 'warning');
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
    const date = new Date(snapshot.generatedAt);
    const generatedAt = Number.isNaN(date.getTime()) ? snapshot.generatedAt : date.toLocaleString(language);
    const origin = el('p', [snapshot.projectLabel, snapshot.embedding?.model, generatedAt].filter(Boolean).join(' · '), 'benchmark-origin hint');
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

function readerSource(projectId: string, label: string, path: string, start?: number, end?: number, symbol?: string, description?: string,
    snapshotId?: string): ReaderSource {
    const location = path + (start ? ':' + start + (end && end > start ? '–' + end : '') : '');
    const source: ReaderSource = { label, description, location, filename: path.split('/').at(-1) };
    if (!path || !start || start < 1) return source;
    const args = { ...indexedLocation(path, start), ...(snapshotId ? { snapshotId, ...(symbol ? { symbol } : {}) } : {}) };
    source.href = route('graph', projectId, args);
    source.open = () => navigate('graph', projectId, args);
    source.excerpt = async signal => {
        const unit = await api<CodeUnit>('/locate', { ...args, projectId }, { signal }).catch(error => {
            if (error instanceof RequestError && error.status === 404) return undefined;
            throw error;
        });
        if (!unit || unit.filePath !== path || (symbol && unit.qualifiedName !== symbol) || unit.startLine > start || unit.endLine < start) return;
        const offset = start - unit.startLine;
        const count = Math.min(12, (end ?? unit.endLine) - start + 1);
        const lines = unit.rawSource.split(/\r?\n/).slice(offset, offset + count).map(line => line.slice(0, 1600));
        return lines.some(line => line.trim()) ? { firstLine: start, lines } : undefined;
    };
    return source;
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
    if (!architectureReader) {
        const reader = el('div', '', 'document-reader');
        reader.id = 'architecture-reader';
        reader.dataset.documentReader = '';
        content.replaceChildren(reader);
        architectureReader = new DocumentReader(reader, t);
    }
    const references = review.evidence.map(item => readerSource(review.projectId, item.citationId,
        item.filePath ?? item.location, item.line, undefined, undefined, item.summary));
    const byId = new Map(review.evidence.map((item, index) => [item.citationId, index]));
    const sections: { title: string; content: HTMLElement; references?: number[] }[] = [];
    const evidence = el('ul');
    for (const item of review.evidence) evidence.append(el('li', item.citationId + ' · ' + item.summary));
    sections.push({ title: t('architectureEvidence'), content: evidence, references: references.map((_, index) => index) });
    if (review.observations.length) {
        const observations = el('ul');
        observations.append(...review.observations.map(observation => el('li', observation)));
        sections.push({ title: t('architectureObservations'), content: observations });
    }
    for (const candidate of review.candidates) {
        const row = el('div');
        row.append(el('p', [candidate.location, candidate.methodology, ...candidate.citations].join(' · '), 'mono hint'));
        for (const [key, value] of [['architectureProblem', candidate.problem], ['architectureSuggestion', candidate.suggestion],
            ['architectureBenefit', candidate.benefit], ['architectureCost', candidate.cost], ['architectureRisk', candidate.risk]]) {
            const field = el('p');
            field.append(el('strong', t(key)), ' · ' + value);
            row.append(field);
        }
        sections.push({ title: candidate.title, content: row, references: candidate.citations.flatMap(id => {
            const index = byId.get(id);
            return index === undefined ? [] : [index];
        }) });
    }
    let usage = '';
    if (review.usage) {
        const { inputTokens, outputTokens, costUsd } = review.usage;
        usage = [t('architectureUsage'), review.model, `${inputTokens ?? '—'} / ${outputTokens ?? '—'} tokens`,
            costUsd === null ? t('architecturePriceUnknown') : new Intl.NumberFormat(language, {
                style: 'currency', currency: 'USD', maximumFractionDigits: 6
            }).format(costUsd)].join(' · ');
    }
    if (review.missingInfo.length) {
        const omissions = el('ul');
        omissions.append(...review.missingInfo.map(reason => el('li', t(reason))));
        sections.push({ title: t('wikiNotes'), content: omissions });
    }
    architectureReader.show({ id: review.projectId + ':' + review.generatedAt, title: t('architectureReview'),
        introduction: t(review.status === 'DISABLED' ? 'architectureDisabled' : review.status === 'FAILED' ? 'architectureFailed' : 'COMPLETED'),
        metadata: [new Date(review.generatedAt).toLocaleString(language), usage].filter(Boolean).join(' · '),
        sections, references });
}

function loadChangeReview(id: string | null, runId: string | null = null) {
    controllers.get('change')?.abort();
    controllers.get('change-export')?.abort();
    controllers.get('change-model')?.abort();
    controllers.get('change-cancel')?.abort();
    controllers.get('change-ask')?.abort();
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
    report('change-ask-status');
    const projectId = selected;
    if (!projectId || !isUuid(id)) return;
    void run('change', signal => api<ChangeSnapshot>(`/change-reviews/${id}`, { projectId }, { signal }), snapshot => {
        changeSnapshot = snapshot;
        renderChangeReview(snapshot);
        if (location.hash.startsWith('#change-finding-' + snapshot.id + '-')) {
            const pointed = document.getElementById(location.hash.slice(1));
            if (pointed instanceof HTMLDetailsElement) {
                pointed.open = true;
                pointed.scrollIntoView({ block: 'start' });
            }
        }
        report('change-status');
        if (isUuid(runId)) void trackChangeRun(snapshot, runId);
    });
}

let changeVersionProject = '';
let canCaptureWorkingCopy = false;

function syncChangeSource() {
    const project = projects.find(item => item.projectId === selected);
    const workingOption = element<HTMLOptionElement>('change-working-option');
    workingOption.disabled = workingOption.hidden = !canCaptureWorkingCopy || !project || !!project.archiveName || !!project.assetId || !!project.git;
    const source = select('change-source');
    if (source.value === 'working' && workingOption.disabled) source.value = 'diff';
    const working = source.value === 'working';
    const usesSnapshot = source.value !== 'diff';
    element('change-published-fields').hidden = !usesSnapshot;
    element('change-target-field').hidden = working;
    element('change-paste-fields').hidden = usesSnapshot;
    element<HTMLTextAreaElement>('change-diff').disabled = usesSnapshot;
    element('change-paths-field').hidden = !working;
    element<HTMLTextAreaElement>('change-paths').disabled = !working;
    const base = select('change-base-snapshot');
    const target = select('change-target-snapshot');
    base.disabled = target.disabled = true;
    controllers.get('change-versions')?.abort();
    report('change-versions-status');
    const projectId = selected;
    if (!usesSnapshot || !projectId) return;
    const continueSelection = changeVersionProject === projectId;
    const currentBase = continueSelection ? base.value : '';
    const currentTarget = continueSelection ? target.value : '';
    void run('change-versions', signal => api<WikiSnapshot[]>('/knowledge-snapshots', { projectId, limit: '100' }, { signal }), versions => {
        changeVersionProject = projectId;
        const label = (item: WikiSnapshot) => new Date(item.publishedAt).toLocaleString(language) + ' · '
            + (item.source?.type === 'GIT' ? item.source.gitCommit : item.id).slice(0, 8);
        const policies = working ? [] : [new Option(t('changeUsePrevious'), ''), new Option(t('changeFullSnapshot'), 'full')];
        base.replaceChildren(...policies, ...versions.map(item => new Option(label(item), item.id)));
        target.replaceChildren(...versions.map(item => new Option(label(item), item.id)));
        if ([...base.options].some(option => option.value === currentBase)) base.value = currentBase;
        if (versions.some(item => item.id === currentTarget)) target.value = currentTarget;
        base.disabled = !versions.length;
        target.disabled = working || !versions.length;
        report('change-versions-status', versions.length ? '' : 'changeVersionsEmpty', '', 'warning');
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
        evidenceLocation(finding.filePath, finding.startLine, finding.startLine), t(finding.severity)]);
    element('finding-list-content').replaceChildren(qualityTable(['findingRule', 'file', 'findingSeverity'], rows));
    element<HTMLButtonElement>('findings-previous').disabled = page.offset === 0;
    element<HTMLButtonElement>('findings-next').disabled = !page.hasMore;
}

function renderFindingDetail(entry: FindingDetail) {
    const { finding, report: assessment } = entry;
    const content = element('finding-detail-content');
    content.replaceChildren(el('h3', `${finding.tool} · ${finding.ruleId}`),
        el('p', [t(finding.severity), finding.cwe, t(assessment.verdict)].filter(Boolean).join(' · '), 'kind'),
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
            ...(hasPaths ? [String(trace.path ?? '—')] : []), trace.filePath, `${trace.startLine}–${trace.endLine}`, t(trace.kind.toUpperCase())
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
    status.dataset.localeDraft = 'finding-status';
    for (const value of ['NEEDS_REVIEW', 'TRUE_POSITIVE', 'FALSE_POSITIVE', 'FIXED']) status.add(new Option(t(value), value));
    const reasons = document.createElement('textarea');
    reasons.dataset.localeDraft = 'finding-reason';
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
        finding.startLine > 0 ? `${finding.filePath}:${finding.startLine}` : finding.filePath, t(finding.severity), t(finding.status)]);
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
    content.replaceChildren(el('h3', finding.title), el('p', [t(finding.status), t(finding.severity), finding.cwe].filter(Boolean).join(' · '), 'kind'));
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
        reason.dataset.localeDraft = 'vulnerability-reason';
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
        return [checkbox, detail, t(entry.severity), t(entry.status), entry.claimedBy || '—'];
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
    content.replaceChildren(el('h3', entry.ruleId), el('p', [t(entry.status), t(entry.severity), entry.claimedBy].filter(Boolean).join(' · '), 'kind'),
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
            const details = [frozen.developerSummary, ...frozen.reasons.map(diagnostic), ...frozen.missingInfo.map(diagnostic), frozen.remediation];
            for (const line of details.filter(Boolean)) {
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
        reason.dataset.localeDraft = 'queue-reason';
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

function showWikiDocument(visible: boolean) {
    const generate = element('wiki-generate');
    const actions = element(visible ? 'wiki-action-items' : 'wiki-primary-action');
    if (generate.parentElement !== actions) actions.append(generate);
    element('wiki-document').hidden = !visible;
}

function resetWiki() {
    element('wiki-ask').hidden = true;
    wikiReader.clear();
    wikiSummary = undefined;
    wikiScope = undefined;
    wikiLifecycle = undefined;
    wikiLifecycleRequest = undefined;
    const settings = element<HTMLDetailsElement>('wiki-settings');
    settings.open = false;
    settings.hidden = true;
    element('wiki-snapshot-tab').hidden = true;
    wikiSettingsTabs.refresh();
    clearWikiEdits();
    clearWikiSearch();
    wikiRun = undefined;
    wikiExecution = undefined;
    wikiSubmission = undefined;
    showWikiDocument(false);
    element('wiki-run').hidden = true;
    element('wiki-execution').hidden = true;
    report('wiki-control-status');
    element<HTMLButtonElement>('wiki-generate').disabled = false;
    element('wiki-export').removeAttribute('href');
    element('wiki-steps').replaceChildren();
    select('wiki-select').replaceChildren();
    select('wiki-snapshot-select').replaceChildren();
    element('wiki-scope').hidden = true;
    element('wiki-search-form').hidden = true;
    report('wiki-generation-status');
}

function clearWikiEdits() {
    for (const key of ['wiki-write', 'wiki-draft', 'wiki-history', 'wiki-artifact-list', 'wiki-artifact-create']) {
        controllers.get(key)?.abort();
        report(key + '-status');
    }
    wikiComparison = undefined;
    wikiWriteRequest = undefined;
    wikiEditSource = undefined;
    element('wiki-edit-form').hidden = true;
    element<HTMLTextAreaElement>('wiki-edit-markdown').value = '';
    element<HTMLTextAreaElement>('wiki-draft-instruction').value = '';
    element<HTMLDetailsElement>('wiki-drafts').open = false;
    element<HTMLDetailsElement>('wiki-artifacts').open = false;
    wikiArtifactList = undefined;
    renderWikiArtifacts();
}

function clearWikiSearch() {
    controllers.get('wiki-search')?.abort();
    const results = element('wiki-search-results');
    results.hidden = true;
    results.replaceChildren();
    report('wiki-search-status');
}

function loadWiki(params: URLSearchParams) {
    const documentId = params.get('document');
    const snapshotId = params.get('snapshotId');
    const revisionId = params.get('revisionId');
    const perspective = params.get('perspective');
    const projectId = selected;
    if (!projectId) { report('wiki-status', 'pickFirst', '', 'warning'); return; }
    if (documentId !== wikiSummary?.document.id || revisionId !== (wikiSummary?.document.revision?.id ?? null)) {
        wikiReader.suspend();
        showWikiDocument(false);
        clearWikiEdits();
    }
    void run('wiki', async signal => {
        const document = isUuid(documentId) ? await api<WikiDocument>(`/summaries/${documentId}`, {
            projectId, ...(snapshotId ? { snapshotId } : {}), ...(revisionId ? { revisionId } : {}),
            ...(perspective ? { perspective } : {}), permissions: 'true'
        }, { signal }) : undefined;
        const kind = document?.perspective ?? (perspective === 'business' ? 'business' : 'technical');
        const release = snapshotId ?? document?.knowledgeSnapshotId;
        const args = { projectId, perspective: kind, ...(release ? { snapshotId: release } : {}) };
        const [tree, snapshots, runs, rights] = await Promise.all([
            api<WikiNode[]>('/summaries/tree', args, { signal }),
            api<WikiSnapshot[]>('/knowledge-snapshots', { projectId, limit: '100' }, { signal }),
            params.has('run') ? Promise.resolve([]) : api<AgentRun[]>('/agent-runs', { projectId, limit: '1', playbook: 'WIKI_SUMMARY' }, { signal }),
            api<{ canManage: boolean }>(`/projects/${projectId}/capabilities`, {}, { signal })
        ]);
        const first = tree.find(item => item.path === params.get('pagePath')) ?? tree[0];
        const page = document ?? (first ? await api<WikiDocument>(`/summaries/${first.id}`,
            { ...args, permissions: 'true' }, { signal }) : undefined);
        const scope = { projectId, snapshots, perspective: kind, source: page?.knowledgeSnapshotId ?? release ?? snapshots[0]?.id,
            canManage: rights.canManage };
        if (!page) return { scope, existingRun: runs[0] };
        const [revisions, drafts] = await Promise.all([
            api<WikiRevisions>(`/summaries/${page.id}/revisions`, args, { signal }),
            page.canEdit ? api<WikiDraftListing[]>(`/summaries/${page.id}/drafts`, args, { signal }) : Promise.resolve([])
        ]);
        return { reading: { tree, document: page, revisions, drafts }, scope, existingRun: runs[0] };
    }, ({ reading, scope, existingRun }) => {
        if (existingRun && ['QUEUED', 'RUNNING', 'PAUSED'].includes(existingRun.status)) {
            const url = new URL(location.href);
            if (!url.searchParams.has('run')) {
                url.searchParams.set('run', existingRun.id);
                history.replaceState(null, '', url.href);
                void trackWiki(existingRun.id);
            }
        }
        if (scope.projectId !== wikiScope?.projectId || scope.perspective !== wikiScope.perspective || scope.source !== wikiScope.source) {
            clearWikiSearch();
        }
        wikiScope = scope;
        wikiSummary = reading;
        renderWikiScope();
        if (scope.canManage && element<HTMLDetailsElement>('wiki-settings').open
            && wikiSettingsTabs.active === 'wiki-snapshot-management') loadWikiLifecycle();
        if (!reading) {
            wikiReader.clear();
            showWikiDocument(false);
            report('wiki-status', 'wikiEmpty');
            return;
        }
        renderWiki(reading);
        const section = params.get('section');
        if (section !== null && /^\d+$/.test(section)) wikiReader.openSection(Number(section));
        report('wiki-status');
    });
}

const wikiFence = /^ {0,3}(`{3,}|~{3,})/;
const wikiHeading = /^ {0,3}(#{1,6})\s+(.+)$/;
const wikiItem = /^ {0,3}([-+*]|\d+[.)])\s+(.+)$/;
const indexedWikiHeadings = new Map([
    ['Overview', 'wikiFactOverview'], ['Modules', 'wikiFactModules'], ['Entry points and direct calls', 'wikiFactEntrypoints'],
    ['Complexity hotspots', 'wikiFactHotspots'], ['Module facts', 'wikiFactModule'],
    ['Cross-module dependencies', 'wikiFactDependencies'], ['Key symbols', 'wikiFactSymbols']
]);

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
    const lines = body.replace(/^\ufeff/, '').split(/\r\n|\n|\r/);
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

function renderWikiScope() {
    if (!wikiScope) return;
    const { projectId, perspective, snapshots, source } = wikiScope;
    const snapshotPicker = select('wiki-snapshot-select');
    const format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    const label = (id: string, time?: string) => time
        ? `${format.format(new Date(time))} · ${id.slice(0, 8)}` : id.slice(0, 8);
    const options = [new Option(t('wikiLatest'), ''), ...snapshots.map(snapshot => new Option(label(snapshot.id, snapshot.publishedAt), snapshot.id))];
    if (source && !snapshots.some(snapshot => snapshot.id === source)) options.push(new Option(label(source), source));
    snapshotPicker.replaceChildren(...options);
    snapshotPicker.value = source ?? '';
    const perspectivePicker = select('wiki-perspective');
    perspectivePicker.replaceChildren(new Option(t('technical'), 'technical'), new Option(t('business'), 'business'));
    perspectivePicker.value = perspective;
    const visible = Boolean(source || wikiSummary?.document);
    element('wiki-scope').hidden = !visible;
    element('wiki-snapshot-control').hidden = !source;
    element('wiki-search-form').hidden = !source;
    const ask = element<HTMLAnchorElement>('wiki-ask');
    ask.hidden = !source;
    if (source) ask.href = route('ask', projectId, { snapshotId: source });
    element('wiki-settings').hidden = false;
    element('wiki-snapshot-tab').hidden = !wikiScope.canManage;
    wikiSettingsTabs.refresh();
}

function loadWikiLifecycle(append = false) {
    const scope = wikiScope;
    if (!scope?.canManage) return;
    const { projectId, source } = scope;
    const previous = append ? wikiLifecycle?.retired.snapshots ?? [] : [];
    if (!append) {
        wikiLifecycle = undefined;
        renderWikiLifecycle();
    }
    void run('wiki-lifecycle', async signal => {
        const [retired, active] = await Promise.all([
            api<RetiredSnapshots>('/knowledge-snapshots/retired', { projectId, offset: String(previous.length) }, { signal }),
            source ? api<WikiLifecycle>(`/knowledge-snapshots/${source}/lifecycle`, { projectId }, { signal }) : undefined
        ]);
        return { active, retired: { ...retired, snapshots: [...previous, ...retired.snapshots] } };
    }, current => {
        if (wikiScope !== scope) return;
        wikiLifecycle = current;
        renderWikiLifecycle();
        report('wiki-lifecycle-status');
    });
}

function renderWikiLifecycle() {
    const selected = select('wiki-retired-snapshot');
    const value = selected.value;
    const entries = wikiLifecycle?.retired.snapshots ?? [];
    const label = (snapshot: WikiLifecycle) => new Date(snapshot.publishedAt).toLocaleString(language) + ' · ' + snapshot.id.slice(0, 8);
    selected.replaceChildren(...(entries.length ? entries.map(snapshot => new Option(label(snapshot), snapshot.id))
        : [new Option(wikiLifecycle ? t('wikiNoRetired') : '—', '')]));
    if (entries.some(snapshot => snapshot.id === value)) selected.value = value;
    selected.disabled = !entries.length;
    element('wiki-release-actions').hidden = !wikiLifecycle?.active;
    element('wiki-older-retired').hidden = !wikiLifecycle?.retired.hasMore;
    updateWikiRetiredActions();
}

function selectedRetiredSnapshot() {
    const id = select('wiki-retired-snapshot').value;
    return wikiLifecycle?.retired.snapshots.find(snapshot => snapshot.id === id);
}

function updateWikiRetiredActions() {
    const item = selectedRetiredSnapshot();
    const restore = element('wiki-restore-snapshot');
    restore.hidden = !item;
    const purge = element<HTMLButtonElement>('wiki-purge-snapshot');
    purge.hidden = !item;
    purge.disabled = !item?.collectAfter || item.collectAfter > Date.now();
    const date = element('wiki-retention-date');
    date.hidden = !item?.collectAfter;
    date.textContent = item?.collectAfter ? t('wikiEligibleAt') + ' · ' + new Date(item.collectAfter).toLocaleString(language) : '';
}

function changeWikiLifecycle(action: 'retire' | 'restore' | 'purge') {
    const scope = wikiScope;
    const snapshot = action === 'retire' ? wikiLifecycle?.active : selectedRetiredSnapshot();
    if (!scope?.canManage || !snapshot || controllers.has('wiki-lifecycle-write')) return;
    if (action === 'purge' && !confirm(t('wikiPurgeConfirm'))) return;
    const payload = { action, revision: snapshot.revision };
    const fingerprint = JSON.stringify([snapshot.id, payload]);
    if (wikiLifecycleRequest?.fingerprint !== fingerprint) wikiLifecycleRequest = { fingerprint, key: crypto.randomUUID() };
    const key = wikiLifecycleRequest.key;
    void run('wiki-lifecycle-write', signal => api<unknown>(`/knowledge-snapshots/${snapshot.id}/lifecycle`, { projectId: scope.projectId }, {
        ...jsonRequest(payload, 'POST', signal), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }
    }), () => {
        if (wikiScope !== scope) return;
        wikiLifecycleRequest = undefined;
        report('wiki-lifecycle-write-status', 'wikiSnapshotUpdated', '', 'success');
        if (action === 'purge') loadWikiLifecycle();
        else navigate('wiki', scope.projectId, { perspective: scope.perspective, ...(action === 'restore' ? { snapshotId: snapshot.id } : {}) });
    });
}

type WikiPageLink = Pick<WikiDocument, 'id' | 'title' | 'perspective' | 'knowledgeSnapshotId' | 'revision'>;

function wikiPageParams(doc: WikiPageLink): Record<string, string> {
    return { document: doc.id, perspective: doc.perspective ?? 'technical',
        ...(doc.knowledgeSnapshotId ? { snapshotId: doc.knowledgeSnapshotId } : {}) };
}

function renderWiki(reading: WikiView) {
    const { tree, document: doc } = reading;
    const selector = select('wiki-select');
    const options = tree.map(item => new Option(item.name + ' · v' + item.docVersion, item.id));
    if (!tree.some(item => item.id === doc.id)) options.push(new Option(doc.title + ' · v' + doc.docVersion, doc.id));
    selector.replaceChildren(...options);
    selector.value = doc.id;
    const revision = doc.revision;
    const exact = { revisionId: revision?.id ?? doc.id };
    element<HTMLAnchorElement>('wiki-export').href = '/api/v1/summaries/' + doc.id + '/export?'
        + new URLSearchParams({ projectId: doc.projectId, ...exact });
    const format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    const references = doc.citations.map(citation => readerSource(doc.projectId, citation.qualifiedName,
        citation.filePath, citation.startLine, citation.endLine, citation.qualifiedName, undefined, doc.knowledgeSnapshotId));
    const locations = doc.citations.map(citation => new RegExp('(?:^|[^\\p{L}\\p{N}_./-])'
        + (citation.filePath + ':' + citation.startLine).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\d)', 'u'));
    const sections = doc.sections.map(section => {
        const content = el('div', '', 'wiki-body');
        const title = section.source === 'manual' ? t('wikiEditedMarkdown')
            : section.source === 'llm' && section.phase ? t('wikiPhase:' + section.phase)
            : !doc.legacyImported && section.source === 'facts' ? t(indexedWikiHeadings.get(section.title) ?? section.title) : section.title;
        if (section.source === 'llm') content.append(el('p', t('wikiModelSection'), 'hint'));
        renderWikiMarkdown(content, section.body);
        const prose = content.textContent;
        return { title, content, references: locations.flatMap((location, index) => location.test(prose) ? [index] : []) };
    });
    if (doc.missingInfo.length) {
        const list = el('ul');
        for (const reason of doc.missingInfo) {
            const [code, phase] = doc.legacyImported ? [reason] : reason.split(':', 2);
            list.append(el('li', phase ? t('wikiPhase:' + phase) + ' · ' + t(code) : t(code)));
        }
        sections.push({ title: t('wikiNotes'), content: list, references: [] });
    }
    showWikiDocument(true);
    wikiReader.show({ id: doc.projectId + ':' + (revision?.id ?? doc.id), title: doc.title, introduction: t('readerWikiIntroduction'),
        metadata: [t(doc.perspective ?? 'technical'), 'v' + doc.docVersion, revision && `${t('wikiRevision')} ${revision.number}`,
            format.format(new Date(revision?.createdAt ?? doc.generatedAt)), t(doc.status), doc.model, doc.legacyImported && t('legacyWiki')]
            .filter(Boolean).join(' · '),
        link: route('wiki', doc.projectId, { ...wikiPageParams(doc), ...exact }), sections, references });
    element('wiki-knowledge-search').hidden = !doc.knowledgeSnapshotId;
    renderWikiHistory(reading);
    element('wiki-artifacts').hidden = !doc.knowledgeSnapshotId;
    const section = select('wiki-artifact-section');
    const before = section.value;
    section.replaceChildren(new Option(t('wikiEntirePage'), ''), ...doc.sections.map((item, index) => new Option(item.title, String(index))));
    if ([...section.options].some(option => option.value === before)) section.value = before;
    renderWikiArtifacts();
}

function loadWikiArtifacts(append = false) {
    const entry = wikiSummary;
    if (!entry?.document.knowledgeSnapshotId) return;
    const doc = entry.document;
    const records = append ? wikiArtifactList?.records ?? [] : [];
    const query = { projectId: doc.projectId, revisionId: doc.revision?.id ?? doc.id, offset: String(records.length) };
    void run('wiki-artifact-list', signal => api<WikiArtifactList>(`/summaries/${doc.id}/exports`, query, { signal }), result => {
        if (wikiSummary !== entry) return;
        wikiArtifactList = { ...result, records: [...new Map([...records, ...result.records].map(item => [item.id, item])).values()] };
        renderWikiArtifacts();
        report('wiki-artifact-list-status', wikiArtifactList.records.length ? '' : 'wikiNoExports');
    });
}

function renderWikiArtifacts() {
    const holder = element('wiki-artifact-results');
    const records = wikiArtifactList?.records ?? [];
    holder.hidden = !records.length;
    holder.replaceChildren(...records.map(item => {
        const row = el('li');
        const download = el('a', { pdf: 'PDF', markdown: 'Markdown', docx: 'Word (.docx)' }[item.format]) as HTMLAnchorElement;
        download.href = item.downloadPath;
        const scope = item.section === null ? t('wikiEntirePage') : wikiSummary?.document.sections[item.section]?.title ?? String(item.section + 1);
        row.append(download, el('span', scope + ' · ' + formatNumber(item.size / 1024, 1) + ' KiB', 'subtle'));
        return row;
    }));
    element('wiki-more-artifacts').hidden = !wikiArtifactList?.hasMore;
}

function prepareWikiArtifact() {
    const entry = wikiSummary;
    if (!entry?.document.knowledgeSnapshotId || controllers.has('wiki-artifact-create')) return;
    const doc = entry.document;
    const section = select('wiki-artifact-section').value;
    const payload = { revisionId: doc.revision?.id ?? doc.id, format: select('wiki-artifact-format').value,
        ...(section === '' ? {} : { section: Number(section) }) };
    void run('wiki-artifact-create', signal => api<WikiArtifact>(`/summaries/${doc.id}/exports`, { projectId: doc.projectId },
        jsonRequest(payload, 'POST', signal)), artifact => {
        if (wikiSummary !== entry) return;
        const previous = wikiArtifactList ?? { records: [], offset: 0, hasMore: false };
        wikiArtifactList = { ...previous, records: [artifact, ...previous.records.filter(item => item.id !== artifact.id)] };
        renderWikiArtifacts();
        report('wiki-artifact-list-status');
        report('wiki-artifact-create-status', 'wikiExportReady', '', 'success');
    });
}

function renderWikiHistory(reading: WikiView) {
    const { document: doc, revisions, drafts } = reading;
    const selectedRevision = doc.revision;
    const items = revisions.revisions.slice();
    if (selectedRevision && !items.some(item => item.id === selectedRevision.id)) items.push(selectedRevision);
    const picker = select('wiki-revision');
    const format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    picker.replaceChildren(...items.map(item =>
        new Option(`#${item.number} · ${t('wikiOrigin:' + item.origin)} · ${format.format(new Date(item.createdAt))}`, item.id)));
    picker.value = selectedRevision?.id ?? doc.id;
    element('wiki-older-revisions').hidden = revisions.revisions.length >= revisions.total;
    const current = selectedRevision?.id === items[0]?.id;
    element('wiki-restore-revision').hidden = !doc.canEdit || current;
    element('wiki-open-edit').hidden = !doc.canEdit || !current;
    element('wiki-drafts').hidden = !doc.canEdit;
    element<HTMLTextAreaElement>('wiki-draft-instruction').disabled = !current;
    element<HTMLButtonElement>('wiki-generate-draft').disabled = !current;
    select('wiki-draft-select').replaceChildren(new Option(t('wikiDraftChoose'), ''), ...drafts.map(draft => new Option(
        `${t('wikiDraft:' + draft.state)} · ${format.format(new Date(draft.createdAt))} · ${draft.id.slice(0, 8)}`, draft.id)));
    if (wikiComparison) select('wiki-draft-select').value = wikiComparison.id;
    renderWikiComparison();
}

function renderWikiComparison() {
    const draft = wikiComparison;
    element('wiki-draft-view').hidden = !draft;
    element('wiki-draft-review').hidden = draft?.state !== 'PENDING';
    element('wiki-draft-base').textContent = draft?.baseMarkdown ?? '';
    element('wiki-draft-text').textContent = draft?.markdown ?? '';
}

function searchWiki() {
    const scope = wikiScope;
    if (!scope?.source) return;
    const { projectId, perspective, source } = scope;
    const query = input('wiki-search-query').value.trim();
    if (!query) return;
    const results = element('wiki-search-results');
    results.hidden = true;
    void run('wiki-search', signal => api<WikiPageLink[]>('/summaries/search',
        { projectId, perspective, snapshotId: source, q: query, compact: 'true' }, { signal }), matches => {
        results.replaceChildren(...matches.map(doc => {
            const item = el('li');
            const link = el('a', doc.title) as HTMLAnchorElement;
            link.href = route('wiki', projectId, { ...wikiPageParams(doc), ...(doc.revision ? { revisionId: doc.revision.id } : {}) });
            item.append(link);
            return item;
        }));
        results.hidden = !matches.length;
        report('wiki-search-status', matches.length ? 'matches' : 'wikiSearchEmpty', String(matches.length || ''));
    });
}

function loadOlderWikiRevisions() {
    const reading = wikiSummary;
    if (!reading || controllers.has('wiki-history')) return;
    const { document: doc, revisions } = reading;
    void run('wiki-history', signal => api<WikiRevisions>(`/summaries/${doc.id}/revisions`,
        { projectId: doc.projectId, offset: String(revisions.revisions.length) }, { signal }), more => {
        if (wikiSummary !== reading) return;
        const items = new Map([...revisions.revisions, ...more.revisions].map(item => [item.id, item]));
        reading.revisions = { ...more, revisions: [...items.values()] };
        renderWikiHistory(reading);
        report('wiki-history-status');
    });
}

function openWikiEditor() {
    if (!wikiSummary?.document.canEdit) return;
    const doc = wikiSummary.document;
    const field = element<HTMLTextAreaElement>('wiki-edit-markdown');
    if (element('wiki-edit-form').hidden && !wikiEditSource) {
        const markdown = doc.markdown ?? doc.sections.map(section => `## ${section.title}\n\n${section.body}`).join('\n\n');
        field.value = markdown;
        wikiEditSource = { original: markdown, normalized: field.value };
    }
    element('wiki-edit-form').hidden = false;
    field.focus();
}

function wikiEditMarkdown() {
    const value = element<HTMLTextAreaElement>('wiki-edit-markdown').value;
    if (!wikiEditSource) return value;
    const { original, normalized } = wikiEditSource;
    if (value === normalized) return original;
    const breaks = new Set(original.match(/\r\n|\n|\r/g));
    return breaks.size === 1 && !breaks.has('\n') ? value.replace(/\n/g, breaks.values().next().value!) : value;
}

function selectWikiDraft(id: string) {
    const reading = wikiSummary;
    wikiComparison = undefined;
    renderWikiComparison();
    if (!reading?.document.canEdit || !id) {
        controllers.get('wiki-draft')?.abort();
        report('wiki-draft-status');
        return;
    }
    select('wiki-draft-select').value = id;
    const doc = reading.document;
    void run('wiki-draft', signal => api<WikiDraftComparison>(`/summaries/${doc.id}/drafts/${id}`, { projectId: doc.projectId }, { signal }), draft => {
        if (wikiSummary !== reading) return;
        wikiComparison = draft;
        renderWikiComparison();
        report('wiki-draft-status');
    });
}

function writeWiki<T>(reading: WikiView, suffix: string, payload: unknown, saved: (result: T) => void) {
    if (!reading.document.canEdit || controllers.has('wiki-write')) return;
    const doc = reading.document;
    const fingerprint = JSON.stringify([doc.id, suffix, payload]);
    if (wikiWriteRequest?.fingerprint !== fingerprint) wikiWriteRequest = { fingerprint, key: crypto.randomUUID() };
    const key = wikiWriteRequest.key;
    void run('wiki-write', signal => api<T>(`/summaries/${doc.id}${suffix}`, { projectId: doc.projectId }, {
        ...jsonRequest(payload, 'POST', signal), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }
    }), result => {
        if (wikiSummary !== reading) return;
        wikiWriteRequest = undefined;
        saved(result);
    });
}

function currentWikiRevision(reading: WikiView) {
    const selectedRevision = reading.document.revision;
    return selectedRevision?.id === reading.revisions.revisions[0]?.id ? selectedRevision : undefined;
}

function showPublishedWiki(doc: WikiPageLink) {
    navigate('wiki', selected, wikiPageParams(doc));
    report('wiki-write-status', 'wikiRevisionSaved', '', 'success');
}

function editWiki(asDraft: boolean) {
    const reading = wikiSummary;
    const current = reading && currentWikiRevision(reading);
    if (!reading || !current || !wikiEditSource) return;
    const payload = { baseRevisionId: current.id, markdown: wikiEditMarkdown() };
    if (asDraft) writeWiki<WikiDraftListing>(reading, '/drafts', payload, draft => showSavedWikiDraft(reading, draft));
    else writeWiki<WikiDocument>(reading, '/revisions', payload, showPublishedWiki);
}

function showSavedWikiDraft(reading: WikiView, draft: WikiDraftListing) {
    reading.drafts = [draft, ...reading.drafts.filter(item => item.id !== draft.id)];
    renderWikiHistory(reading);
    element<HTMLDetailsElement>('wiki-drafts').open = true;
    selectWikiDraft(draft.id);
    report('wiki-write-status', 'wikiDraftSaved', '', 'success');
}

function reviewWikiDraft(action: 'apply' | 'discard') {
    const reading = wikiSummary;
    const draft = wikiComparison;
    if (!reading || draft?.state !== 'PENDING') return;
    writeWiki<WikiDraftListing>(reading, `/drafts/${draft.id}/${action}`, {}, updated => {
        if (action === 'apply') showPublishedWiki(reading.document);
        else {
            wikiComparison = { ...draft, state: updated.state };
            reading.drafts = reading.drafts.map(item => item.id === updated.id ? updated : item);
            renderWikiHistory(reading);
            report('wiki-write-status', 'wikiDraftDiscarded', '', 'success');
        }
    });
}

function renderWikiExecution(execution?: WikiExecution) {
    wikiExecution = execution;
    const active = execution?.state === 'RUNNING' || execution?.state === 'QUEUED' || execution?.state === 'PAUSED';
    const hasControls = active && (account?.id === execution.actorId || account?.role === 'ADMIN');
    const date = element('wiki-execution-time');
    const scheduled = !!execution && execution.availableAt > Date.now() && execution.attempt === 0;
    date.hidden = !scheduled && !execution?.stopRequested;
    date.textContent = execution?.stopRequested ? t('wikiStopping') : scheduled
        ? `${t('wikiScheduledFor')} · ${new Date(execution.availableAt).toLocaleString(language)}` : '';
    element('wiki-execution').hidden = !hasControls && date.hidden && element('wiki-control-status').hidden;
    element('wiki-job-pause').hidden = !hasControls || execution?.state === 'PAUSED' || !!execution?.stopRequested;
    element('wiki-job-resume').hidden = !hasControls || execution?.state !== 'PAUSED';
    element('wiki-job-cancel').hidden = !hasControls || execution?.stopRequested === 'CANCELLED';
}

function renderWikiRun(run: AgentRun, execution?: WikiExecution) {
    wikiRun = run;
    element('wiki-run').hidden = false;
    renderWikiExecution(execution);
    const steps = el('ol');
    const names: Record<string, string> = { FACTS: 'wikiFactCollection', LLM_ARCH: 'wikiTechnicalGeneration',
        LLM_BUSINESS: 'wikiBusinessGeneration', PERSIST: 'wikiPersist' };
    for (const step of run.steps) {
        const phase = /^LLM_(?:ARCH|BUSINESS):(.+)$/.exec(step.capability)?.[1];
        const capability = phase ? 'wikiPhase:' + phase
            : names[step.capability] ?? step.capability;
        const status = step.status === 'FAILED' ? 'wikiStepFailed' : step.status;
        steps.append(el('li', [t(capability), t(status), step.error ? t(step.error) : step.summary].filter(Boolean).join(' · ')));
    }
    element('wiki-steps').replaceChildren(el('p', t(run.status === 'FAILED' ? 'wikiFailedRun' : run.status), 'kind'), steps);
}

async function wikiRunExecution(runId: string, projectId: string, signal: AbortSignal) {
    return api<WikiExecution>(`/agent-runs/${runId}/execution`, { projectId }, { signal }).catch(error => {
        if (error instanceof RequestError && error.status === 404) return undefined;
        throw error;
    });
}

async function controlWiki(action: JobAction) {
    const execution = wikiExecution;
    if (!execution || controllers.has('wiki-control')) return;
    await run('wiki-control', signal => api<WikiExecution>(`/agent-runs/${execution.id}/execution`, { projectId: execution.projectId },
        jsonRequest({ action, revision: execution.revision }, 'POST', signal)), state => {
        report('wiki-control-status');
        renderWikiExecution(state);
    });
    if (view === 'wiki' && selected === execution.projectId) await trackWiki(execution.id);
}

async function trackWiki(id?: string, notBefore?: string, mode: SnapshotMode = 'incremental') {
    const projectId = selected;
    const trigger = element<HTMLButtonElement>('wiki-generate');
    const pending = controllers.get('wiki-generation');
    if (!projectId) { report('wiki-generation-status', 'pickFirst', '', 'warning'); return; }
    if (pending && !pending.signal.aborted) return;
    trigger.disabled = true;
    await run('wiki-generation', async signal => {
        let runId = id;
        if (!runId) {
            if (!wikiSubmission || wikiSubmission.notBefore !== notBefore || wikiSubmission.mode !== mode) {
                wikiSubmission = { key: crypto.randomUUID(), notBefore, mode };
            }
            const started = await api<{ agentRunId: string }>('/summaries/generate', { projectId, mode, ...(notBefore ? { notBefore } : {}) },
                { method: 'POST', signal, headers: { 'Idempotency-Key': wikiSubmission.key } });
            wikiSubmission = undefined;
            runId = started.agentRunId;
            if (!signal.aborted) history.replaceState(null, '', route('wiki', projectId, {
                run: runId, ...(wikiScope?.perspective === 'business' ? { perspective: 'business' } : {})
            }));
        }
        for (let attempt = 0; attempt < 300 && !signal.aborted; attempt++) {
            const result = await api<AgentRun>(`/agent-runs/${runId}`, { projectId }, { signal });
            if (signal.aborted) return null;
            if (result.playbook !== 'WIKI_SUMMARY') throw new RequestError(404, 'NOT_FOUND');
            const execution = await wikiRunExecution(runId, projectId, signal);
            if (signal.aborted) return null;
            renderWikiRun(result, execution);
            if (result.status !== 'RUNNING' && result.status !== 'QUEUED') return result;
            await new Promise(resolve => setTimeout(resolve, 750));
        }
        return null;
    }, result => {
        if (!result) { report('wiki-generation-status', 'wikiPending', '', 'warning'); return; }
        if (result.status === 'PAUSED' || result.status === 'CANCELLED') {
            report('wiki-generation-status', result.status);
            return;
        }
        if (result.status === 'FAILED') {
            report('wiki-generation-status', 'wikiFailedRun', () => diagnostic(result.statusReason ?? ''), 'error');
            return;
        }
        report('wiki-generation-status', result.status === 'PARTIAL' ? 'wikiPartial' : 'wikiGenerated', '',
            result.status === 'PARTIAL' ? 'warning' : 'success');
        loadWiki(new URL(location.href).searchParams);
    });
    if (selected === projectId && !controllers.has('wiki-generation')) trigger.disabled = false;
}

function openReportAsk(snapshot: ChangeSnapshot, findingId?: string) {
    if (controllers.has('change-ask')) return;
    const review = { projectId: snapshot.projectId, reviewId: snapshot.id, ...(findingId && { findingId }) };
    const key = crypto.randomUUID();
    void run('change-ask', signal => api<{ id: string }>('/ask/sessions', {}, { ...jsonRequest({ review,
        title: (findingId ? t('askChangeFinding') : t('askFrozenReview')) + ' · ' + snapshot.id.slice(0, 8) }, 'POST', signal),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key } }), session => {
        if (changeSnapshot?.id === snapshot.id) location.assign(route('ask', snapshot.projectId, { session: session.id }));
    });
}

function changeFindingDetails(snapshot: ChangeSnapshot, finding: NonNullable<ChangeSnapshot['structuredFindings']>[number]) {
    const id = 'change-finding-' + snapshot.id + '-' + finding.id;
    const panel = el('details', '', 'change-evidence') as HTMLDetailsElement;
    panel.id = id;
    const location = finding.location;
    panel.append(el('summary', finding.ruleId + ' · ' + location.path + ':' + location.startLine),
        el('p', t('change-finding:' + finding.publishability) + ' · ' + finding.tool, 'hint'));
    const source = el('a', () => t('changeOpenVersion')) as HTMLAnchorElement;
    source.href = route('graph', finding.projectId, { snapshotId: finding.snapshotId, file: location.path, line: String(location.startLine) });
    const notice = el('p', '', 'notice');
    notice.id = id + '-status';
    notice.setAttribute('role', 'status');
    notice.hidden = true;
    const status = el('p', '', 'hint');
    const entries = el('ol');
    const controls = el('form', '', 'stack') as HTMLFormElement;
    controls.hidden = true;
    const choice = document.createElement('select');
    const reason = document.createElement('textarea');
    reason.required = true;
    reason.maxLength = 2000;
    reason.rows = 3;
    const actions = el('label');
    actions.append(el('span', () => t('changeDisposition')), choice);
    const why = el('label');
    why.append(el('span', () => t('changeReasonForDecision')), reason);
    const save = el('button', () => t('changeRecordDecision')) as HTMLButtonElement;
    save.type = 'submit';
    controls.append(actions, why, save);
    const reload = el('button', () => t('changeReloadDecisions')) as HTMLButtonElement;
    reload.type = 'button';
    const ask = el('button', () => t('askChangeFinding')) as HTMLButtonElement;
    ask.type = 'button';
    ask.addEventListener('click', () => openReportAsk(snapshot, finding.id));
    panel.append(source, ask, notice, status, entries, controls, reload);
    const trailPath = `/change-reviews/${snapshot.id}/findings/${finding.id}`;
    const args = { projectId: snapshot.projectId };
    let revision = 0;
    let pending: { hash: string; key: string } | undefined;
    function history() {
        void run(id, signal => api<ReturnType<import('./change-review.js').ChangeReviews['findingHistory']>>(trailPath, args, { signal }), data => {
            if (!panel.isConnected) return;
            revision = data.revision;
            const available = ['CONFIRM', 'DISMISS', 'REQUEST_REVIEW', ...(['CONFIRM', 'DISMISS'].some(item => item === data.current) ? ['APPEAL'] : [])];
            const prior = choice.value;
            choice.replaceChildren(...available.map(item => new Option(t('change-finding:' + item), item)));
            if (available.includes(prior)) choice.value = prior;
            status.textContent = t('change-finding:' + String(data.current));
            controls.hidden = !data.editable;
            entries.replaceChildren(...data.entries.map(entry => el('li', t('change-finding:' + String(entry.action)) + ' · '
                + new Date(String(entry.decidedAt)).toLocaleString(language) + ' · ' + String(entry.reason))));
            report(notice.id);
        });
    }
    let opened = false;
    panel.addEventListener('toggle', () => {
        if (panel.open && !opened) { opened = true; history(); }
    });
    reload.addEventListener('click', history);
    controls.addEventListener('submit', event => {
        event.preventDefault();
        const rationale = reason.value.trim();
        if (!rationale || controllers.has(id)) return;
        const payload = { revision, action: choice.value, reason: rationale };
        const hash = JSON.stringify(payload);
        if (pending?.hash !== hash) pending = { hash, key: crypto.randomUUID() };
        const key = pending.key;
        void run(id, signal => api(trailPath, args, { ...jsonRequest(payload, 'POST', signal), headers: {
            'Content-Type': 'application/json', 'Idempotency-Key': key
        } }), () => {
            if (reason.value.trim() === rationale) reason.value = '';
            pending = undefined;
            history();
        });
    });
    return panel;
}

function renderChangeReview(snapshot: ChangeSnapshot) {
    element('change-snapshot').hidden = false;
    element<HTMLAnchorElement>('change-link').href = route('change-review', snapshot.projectId, { snapshot: snapshot.id });
    const symbols = qualityTable(['changeBase', 'changeTarget', 'changePlanned', 'changeOmitted'], [[snapshot.baseVersion,
        snapshot.targetVersion, String(snapshot.plannedHunkCount), String(snapshot.omittedHunkCount)]]);
    const results = element('change-results');
    results.replaceChildren(el('p', t(snapshot.status), 'kind'), symbols);
    const ask = el('button', () => t('askChangeReview')) as HTMLButtonElement;
    ask.type = 'button';
    ask.addEventListener('click', () => openReportAsk(snapshot));
    results.append(ask);
    element('change-model-start').hidden = !snapshot.units.length;
    if (snapshot.provenance) {
        const info = snapshot.provenance;
        results.append(el('p', (info.scope === 'WORKING_COPY_OVERLAY' ? t('changeWorkingCopy') : t('change:' + info.baselineReason)) + ' · ' + t('changeComparedFiles') + ' '
            + snapshot.files.length + '/' + info.totalFiles, 'hint'));
        if (snapshot.files.length) {
            const list = el('ul', '', 'hint');
            list.append(...snapshot.files.slice(0, 100).map(file => el('li', file.oldPath && file.newPath && file.oldPath !== file.newPath
                ? file.oldPath + ' → ' + file.newPath : file.newPath || file.oldPath)));
            results.append(list);
        }
    }
    if (snapshot.legacyImported) results.append(el('p', t('legacyChangeReview'), 'hint'));
    if (snapshot.checkCoverage?.length) {
        const checks = snapshot.checkCoverage.map(check => [check.tool, t('change-check:' + check.status),
            t('change-check:' + check.provenance) + ('reported' in check ? ' · ' + check.accepted + '/' + check.reported : '')]);
        results.append(el('h3', t('changeCheckCoverage')), qualityTable(['changeCheck', 'status', 'changeCheckSource'], checks));
    }
    const dependency = snapshot.dependencyCheck;
    if (dependency) {
        const status = dependency.status === 'COMPLETED' && dependency.findingCount === 0 ? 'ZERO_FINDINGS' : dependency.status;
        const details = el('details');
        details.append(el('summary', t('changeDependencyCheck') + ' · ' + t('change-check:' + status)),
            el('p', t('change-check:' + dependency.provenance) + ' · ' + t('findings') + ' ' + dependency.findingCount));
        if (dependency.manifestDigest) details.append(el('p', t('changeDependencyManifestDigest') + ' ' + dependency.manifestDigest, 'mono wrap'));
        if (dependency.catalogDigest) details.append(el('p', t('changeDependencyCatalogDigest') + ' ' + dependency.catalogDigest, 'mono wrap'));
        if (dependency.reasons.length) details.append(el('p', dependency.reasons.map(t).join(' · '), 'hint'));
        if (dependency.preview.length) details.append(qualityTable(['dependencyAdvisory', 'dependencyCoordinate', 'findingSeverity'],
            dependency.preview.map(finding => [finding.id, finding.coordinate + ' @ ' + finding.version, finding.severity])));
        results.append(details);
    }
    if (snapshot.structuredFindings?.length) {
        results.append(el('h3', t('findings')), ...snapshot.structuredFindings.slice(0, 100).map(finding => changeFindingDetails(snapshot, finding)));
    }
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
            const location = el('p', citation.filePath + ':' + citation.startLine + '–' + citation.endLine, 'mono hint');
            if (snapshot.provenance?.targetSnapshotId && citation.startLine > 0) {
                const source = el('a', () => t('changeOpenVersion')) as HTMLAnchorElement;
                source.href = route('graph', snapshot.projectId, { snapshotId: snapshot.provenance.targetSnapshotId,
                    file: citation.filePath, line: String(citation.startLine), symbol: citation.qualifiedName });
                location.append(' · ', source);
            } else if (snapshot.provenance?.scope === 'WORKING_COPY_OVERLAY') {
                const source = el('a', () => t('changeOpenOverlaySource')) as HTMLAnchorElement;
                source.href = `/api/v1/change-reviews/${snapshot.id}/overlay-source?` + new URLSearchParams({ projectId: snapshot.projectId, file: citation.filePath });
                location.append(' · ', source);
            }
            evidence.append(heading, location, el('pre', citation.excerpt));
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
            item.coordinate + '@' + item.version, t(item.severity)])));
    if (result.matchedFindings > result.preview.length) content.append(el('p', t('dependencyMore'), 'hint'));
    if (result.issues.length) {
        const list = el('ul');
        list.append(...result.issues.map(issue => el('li', diagnostic(issue))));
        content.append(list);
    }
    report('dependency-scan-status', result.unverifiedComponents ? 'dependencyUnverified' : '',
        formatNumber(result.unverifiedComponents), 'warning');
}

function renderSbom(result: Sbom) {
    const content = element('sbom-content');
    const list = el('ul', '', 'mono');
    for (const component of result.components.slice(0, 50)) list.append(el('li', component.purl));
    content.replaceChildren(el('p', `${t('sbomComponents')} · ${formatNumber(result.components.length)} · CycloneDX ${result.specVersion}`, 'hint'));
    if (list.childElementCount) content.append(list);
    if (result.components.length > 50) content.append(el('p', t('sbomPreviewLimit'), 'hint'));
    for (const property of result.metadata.properties ?? []) {
        if (property.name === 'repograph:inventoryIssue') content.append(el('p', diagnostic(property.value), 'hint'));
    }
    element('sbom-download').hidden = false;
    report('sbom-status');
}

function showLogin(key = '') {
    element<HTMLDialogElement>('device-auth').close();
    element('device-auth-open').hidden = true;
    canCaptureWorkingCopy = false;
    element<HTMLTextAreaElement>('change-paths').value = '';
    clearAsk();
    spaceState = undefined;
    spaceDocument = undefined;
    spaceSubmission = undefined;
    spaceDrafts.clear();
    spaceCsvDrafts.clear();
    spaceCsv = undefined;
    element('space-content').hidden = true;
    element<HTMLTextAreaElement>('space-markdown').value = '';
    connected = false;
    architectureReader?.clear();
    architectureReader = undefined;
    indexRequest?.abort();
    indexRequest = undefined;
    indexJob = undefined;
    archiveRequest?.abort();
    archiveRequest = undefined;
    archiveSubmission = undefined;
    archiveReuseSubmission = undefined;
    element<HTMLFormElement>('archive-form').reset();
    element<HTMLFormElement>('git-connect-form').reset();
    element<HTMLFormElement>('git-connection-form').reset();
    gitConnections = [];
    gitSettings = undefined;
    gitOverview = undefined;
    element('archive-status').hidden = true;
    element('profile-content').replaceChildren();
    archiveOverview = undefined;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    if (element<HTMLDialogElement>('source-dialog').open) element<HTMLDialogElement>('source-dialog').close();
    closeAskAttachment();
    clearTimeout(projectTrashTimer);
    projectTrashState = undefined;
    projectAction = undefined;
    element<HTMLDetailsElement>('project-trash').open = false;
    element('project-trash-list').replaceChildren();
    for (const dialog of ['space-generation', 'space-settings', 'space-move', 'space-import']) element<HTMLDialogElement>(dialog).close();
    spaceImportSubmission = undefined;
    element<HTMLDetailsElement>('space-deleted-list').open = false;
    element('space-deleted-items').replaceChildren();
    spaceGenerationSubmission = undefined;
    input('ask-attachment-files').value = '';
    askCreation = undefined;
    askAttachmentChange = undefined;
    projects = [];
    repositoryFilter = 'all';
    select('repo-kind').value = 'all';
    element<HTMLDialogElement>('index-section').close();
    adminTabs.select('admin-accounts');
    closeMenu();
    input('repo-filter').value = '';
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
    document.getElementById('overview-distributions')?.remove();
    element('overview-root').textContent = '';
    for (const panel of ['search', 'graph', 'evidence']) element(`${panel}-results`).replaceChildren();
    flowView = undefined;
    graphView = undefined;
    searchHits = [];
    knowledgeResults = undefined;
    knowledgeSpaces = [];
    knowledgePinned = undefined;
    knowledgeOptionsLoaded = false;
    element('knowledge-coverage').hidden = true;
    searchPreview = 0;
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
    const [current, result] = await Promise.all([api<Account>('/auth/me'), api<DashboardProject[]>('/projects', { summary: 'true' })]);
    account = current;
    projects = result;
    connected = true;
    element('admin-nav').hidden = current.role !== 'ADMIN';
    element('connect-repository').hidden = current.role !== 'ADMIN';
    element('login').hidden = true;
    element('workspace').hidden = false;
    readRoute();
    report('repositories-status');
    const deviceLink = new URL(location.href);
    void api<{ features: Record<string, boolean> }>('/capabilities').then(result => {
        if (!connected || account?.id !== current.id) return;
        element('device-auth-open').hidden = !result.features.deviceAuthorization;
        const compare = element<HTMLOptionElement>('change-published-option');
        compare.disabled = compare.hidden = !result.features.verifiedChangeReview;
        canCaptureWorkingCopy = !!result.features.workingCopyReview;
        if (view === 'change-review') syncChangeSource();
        if (result.features.deviceAuthorization && deviceLink.searchParams.get('authorizeDevice') === '1') {
            const url = new URL(location.href);
            url.searchParams.delete('authorizeDevice');
            history.replaceState(history.state, '', url);
            openDeviceAuthorization();
        }
    }).catch(() => {});
}

let reviewedDevice: string | undefined;
const devicePath = '/auth/device';

function loadDeviceCredentials() {
    void run('device-credentials', signal => api<{ id: string; clientName: string; expiresAt: number }[]>(devicePath + '/credentials', {}, { signal }),
        result => {
            const rows = result.map(item => {
                const revoke = resultButton('deviceRevoke', () => {
                    void run('device-revoke', signal => api(devicePath + '/credentials/' + item.id, {}, { method: 'DELETE', signal }), () => {
                        report('device-revoke-status', 'deviceRevoked', '', 'success');
                        loadDeviceCredentials();
                    });
                });
                const info = el('span', item.clientName + ' · ' + new Date(item.expiresAt).toLocaleDateString(language));
                return spaceItemRow(info, revoke);
            });
            element('device-credentials').replaceChildren(...rows.length ? rows : [el('li', () => t('deviceNone'), 'hint')]);
            report('device-credentials-status');
        });
}

function resetDeviceReview() {
    reviewedDevice = undefined;
    element('device-client').textContent = '';
    element('device-review').hidden = true;
    report('device-inspect-status');
}

function openDeviceAuthorization() {
    const dialog = element<HTMLDialogElement>('device-auth');
    if (dialog.open) return;
    element<HTMLDetailsElement>('session-actions').open = false;
    element<HTMLFormElement>('device-code-form').reset();
    resetDeviceReview();
    for (const id of ['device-decision-status', 'device-revoke-status']) report(id);
    dialog.showModal();
    loadDeviceCredentials();
}

function decideDevice(approved: boolean) {
    const reviewed = reviewedDevice;
    if (!reviewed || controllers.has('device-decision')) return;
    void run('device-decision', signal => api(devicePath + '/decision', {}, jsonRequest({ code: reviewed, approved }, 'POST', signal)), () => {
        element<HTMLFormElement>('device-code-form').reset();
        resetDeviceReview();
        report('device-decision-status', approved ? 'deviceApproved' : 'deviceDenied', '', 'success');
        loadDeviceCredentials();
    });
}

function showJob(status: IndexJob) {
    indexJob = status;
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
            node.append(el('span', `${stage} · ${formatNumber(done)} / ${formatNumber(total)}`));
            const bar = document.createElement('progress');
            bar.max = total;
            bar.value = done;
            bar.setAttribute('aria-label', stage);
            node.append(bar);
        } else {
            node.append(el('span', stage));
        }
        if (status.stage === 'embedding' && status.totalFiles) {
            node.append(el('span', `${t('indexProcessed')} · ${formatNumber(status.processedFiles ?? 0)} / ${formatNumber(status.totalFiles)}`));
        }
    }
    if (status.parsedFiles !== undefined) {
        node.append(el('span', `${t('filesParsed')} ${formatNumber(status.parsedFiles)} · ${t('filesSkipped')} ${formatNumber(status.skippedFiles ?? 0)}`));
        if (status.degradedFiles) node.append(el('span', `${t('filesDegraded')} ${formatNumber(status.degradedFiles)}`));
        node.append(el('span', `${formatNumber(status.totalUnits ?? 0)} ${t('units')} · ${formatNumber(status.totalEdges ?? 0)} ${t('relations')}`));
    }
    if (status.errors?.length) {
        const errors = el('ul');
        errors.append(...status.errors.slice(0, 15).map(error => el('li', diagnostic(error))));
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
            void refreshProjects();
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
        input('archive-display-name').value = result.asset.displayName;
        renderArchiveProfile(result.asset, result.profile);
    });
}

async function waitArchive(asset: ArchiveAsset, signal: AbortSignal, status: string) {
    while (asset.status === 'INDEXING') {
        signal.throwIfAborted();
        report(status, 'indexing', asset.displayName);
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
        ['archiveDigest', asset.sourceObject?.sha256 ?? ''],
        ...(profile ? [
            ['archiveFiles', String(profile.totalFiles)],
            ['categories', Object.entries(profile.categoryDistribution).map(([category, count]) => `${t(category)} ${count}`).join(' · ')],
            ['languageBreakdown', Object.entries(profile.languageDistribution).map(([language, count]) => `${t(language)} ${formatNumber(count)}`).join(' · ')],
            ['buildSystems', profile.buildSystems.join(', ')],
            ['sbomComponents', profile.omittedReasons.includes('DEPENDENCY_INVENTORY_UNAVAILABLE') ? '' : String(profile.dependencies.length)],
            ['frameworks', profile.frameworks.join(', ')],
            ['vulnActive', String(Object.values(profile.vulnerabilityCounts).reduce((total, count) => total + count, 0))],
            ['recommendedScanners', profile.scannerPlan.filter(item => item.selected).map(item => item.scanner).join(', ')]
        ] : [])
    ];
    for (const [label, data] of fields) {
        if (data) details.append(el('dt', t(label)), el('dd', data, label === 'archiveDigest' ? 'mono archive-digest' : undefined));
    }
    const administrator = account?.role === 'ADMIN';
    element('archive-identity-form').hidden = !(administrator || asset.canEdit);
    element('archive-reuse').hidden = !administrator || !asset.sourceObject;
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
        () => [asset.error, ...errors.slice(0, 3)].filter(Boolean).map(diagnostic).join(' · '),
        asset.status === 'FAILED' ? 'error' : errors.length ? 'warning' : 'success');
    for (const issue of profile?.dependencyIssues ?? []) content.append(el('p', diagnostic(issue), 'hint'));
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
    const strategy = select('archive-strategy').value;
    const includeBytecode = String(input('archive-bytecode').checked || /\.jar$/i.test(file.name));
    if (archiveSubmission?.file !== file || archiveSubmission.strategy !== strategy || archiveSubmission.includeBytecode !== includeBytecode) {
        archiveSubmission = { file, strategy, includeBytecode, key: crypto.randomUUID() };
    }
    try {
        const body = new FormData();
        body.append('file', file);
        const started = await api<ArchiveAsset>('/assets/import', { strategy, includeBytecode }, {
            method: 'POST', body, signal: controller.signal, headers: { 'Idempotency-Key': archiveSubmission.key }
        });
        void refreshProjects();
        const asset = await waitArchive(started, controller.signal, 'archive-status');
        if (controller.signal.aborted) return;
        const errors = asset.indexResult?.errors ?? [];
        report('archive-status', asset.status === 'FAILED' ? 'archiveFailed' : errors.length ? 'archivePartial' : 'archiveReady',
            () => [asset.originalFileName, ...[asset.error, ...errors.slice(0, 3)].filter(Boolean).map(diagnostic)].join(' · '),
            asset.status === 'FAILED' ? 'error' : errors.length ? 'warning' : 'success');
        element<HTMLFormElement>('archive-form').reset();
        archiveSubmission = undefined;
        await refreshProjects();
    } catch (error) {
        if (!controller.signal.aborted) showFailure('archive-status', error);
    } finally {
        if (archiveRequest === controller) archiveRequest = undefined;
        submit.disabled = false;
    }
}

function renameArchive() {
    const current = archiveOverview;
    const displayName = input('archive-display-name').value.trim();
    if (!current || !displayName || displayName === current.asset.displayName || controllers.has('archive-identity')) return;
    void run('archive-identity', async signal => {
        const asset = await api<ArchiveAsset>('/assets/' + current.asset.assetId, {},
            jsonRequest({ displayName, revision: current.asset.revision }, 'PATCH', signal));
        await refreshProjects();
        return { ...asset, canEdit: current.asset.canEdit };
    }, asset => {
        archiveOverview = { ...current, asset };
        input('archive-display-name').value = asset.displayName;
        renderArchiveProfile(asset, current.profile);
        if (overview) renderOverview(overview);
        report('archive-identity-status', 'archiveRenamed', '', 'success');
    });
}

function reuseArchive() {
    const current = archiveOverview?.asset;
    const displayName = input('archive-display-name').value.trim();
    if (!current || !displayName || controllers.has('archive-identity')) return;
    if (archiveReuseSubmission?.id !== current.assetId || archiveReuseSubmission.displayName !== displayName) {
        archiveReuseSubmission = { id: current.assetId, displayName, key: crypto.randomUUID() };
    }
    const key = archiveReuseSubmission.key;
    void run('archive-identity', async signal => {
        const request = jsonRequest({ displayName }, 'POST', signal);
        const headers = new Headers(request.headers);
        headers.set('Idempotency-Key', key);
        const result = await api<ArchiveAsset>('/assets/' + current.assetId + '/reuse', {
            includeBytecode: String(/\.jar$/i.test(current.originalFileName))
        }, { ...request, headers });
        await refreshProjects();
        return result;
    }, result => {
        archiveReuseSubmission = undefined;
        navigate('overview', result.projectId);
    });
}

function showSource(unit: CodeUnit, project: string, snapshotId?: string) {
    const dialog = element<HTMLDialogElement>('source-dialog');
    sourceFocus = document.activeElement as HTMLElement | null;
    element('source-title').textContent = unit.qualifiedName;
    element('source-path').textContent = locationLabel(unit, project, unit.metadata.archive_entry);
    element('source-content').textContent = unit.rawSource;
    const location = unit.startLine > 0 ? indexedLocation(unit.filePath, unit.startLine, unit.metadata.archive_entry) : { target: unit.id };
    element<HTMLAnchorElement>('source-link').href = route('graph', project, {
        ...location, ...(snapshotId ? { snapshotId, symbol: unit.qualifiedName } : {})
    });
    report('copy-status');
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
    const { unit, projectId, snapshotId } = hit;
    const article = el('article', '', 'surface result');
    const header = el('div', '', 'result-top');
    const label = el('div');
    label.append(el('h2', unit.qualifiedName), el('p', locationLabel(unit, projectId, unit.metadata.archive_entry), 'mono'));
    const actions = el('div', '', 'row-actions');
    actions.append(resultButton(unit.metadata.bytecode === 'true' ? 'openSignature' : 'openSource', () => showSource(unit, projectId, snapshotId)),
        resultButton('graph', () => navigate('graph', projectId, { target: unit.id, ...(snapshotId ? { snapshotId } : {}) })));
    header.append(label, actions);
    const score = hit.finalScore ?? hit.score;
    article.append(header, el('span', () => [t(unit.kind), t(unit.language), t(hit.relation ?? ''), score && score >= 0.001 ? formatNumber(score, 3) : '']
        .filter(Boolean).join(' · '), 'kind'));
    if (unit.signature) article.append(el('pre', unit.signature));
    return article;
}
function normalizeResults(value: Hit[] | { results: Hit[] }) { return Array.isArray(value) ? value : value.results; }

function restoreKnowledgeSearch(params: URLSearchParams) {
    if (params.get('mode') === 'knowledge') {
        const pageId = params.get('pageId'), revisionId = params.get('revisionId'), snapshotId = params.get('snapshotId');
        const spaceId = params.get('spaceId'), documentId = params.get('documentId'), versionId = params.get('versionId');
        const pinned: KnowledgeScope | undefined = selected && isUuid(snapshotId) && isUuid(pageId) && isUuid(revisionId)
            ? { kind: 'wiki', projectId: selected, snapshotId, pageId, revisionId }
            : isUuid(spaceId) && isUuid(documentId) && isUuid(versionId) ? { kind: 'document', spaceId, documentId, versionId }
                : selected && isUuid(snapshotId) ? { kind: 'repository', projectId: selected, snapshotId } : undefined;
        if (JSON.stringify(pinned) !== JSON.stringify(knowledgePinned)) resetSearchResults();
        knowledgePinned = pinned;
        select('search-mode').value = 'knowledge';
        for (const button of document.querySelectorAll<HTMLElement>('[data-query-modes="search-mode"] [data-query-option]')) {
            button.setAttribute('aria-pressed', String(button.dataset.queryOption === 'knowledge'));
        }
    } else if (knowledgePinned) {
        knowledgePinned = undefined;
        resetSearchResults();
    }
    renderKnowledgeControls();
}

function renderKnowledgeSources() {
    const field = select('knowledge-sources');
    const retained = new Set(Array.from(field.selectedOptions, option => option.value));
    const repositoryGroup = document.createElement('optgroup');
    repositoryGroup.label = t('repositories');
    for (const project of projects) repositoryGroup.append(new Option(repositoryName(project), 'repository/' + project.projectId));
    const spaceGroup = document.createElement('optgroup');
    spaceGroup.label = t('spaces');
    for (const space of knowledgeSpaces) spaceGroup.append(new Option(space.name, 'space/' + space.id));
    field.replaceChildren(...[repositoryGroup, spaceGroup].filter(group => group.childElementCount));
    for (const option of field.options) option.selected = retained.has(option.value);
    if (!retained.size && selected) field.value = 'repository/' + selected;
}

function renderKnowledgeControls() {
    const active = select('search-mode').value === 'knowledge';
    element('search-code-scope').hidden = active;
    element('knowledge-scope').hidden = !active || !!knowledgePinned;
    const exact = element('knowledge-pinned');
    exact.hidden = !active || !knowledgePinned;
    if (active && knowledgePinned) {
        const pin = knowledgePinned;
        const version = pin.kind === 'document' ? pin.versionId : pin.kind === 'wiki' ? pin.revisionId
            : pin.kind === 'repository' ? pin.snapshotId : undefined;
        const clear = resultButton('knowledgeChooseScope', () => navigate('search', selected, { mode: 'knowledge' }));
        exact.replaceChildren(el('span', () => t('knowledgeExactScope') + ' · ' + version?.slice(0, 8)), ' ', clear);
    }
    const pending = controllers.get('knowledge-options');
    if (!active || knowledgeOptionsLoaded || !connected || knowledgePinned || (pending && !pending.signal.aborted)) return;
    const controller = new AbortController();
    controllers.set('knowledge-options', controller);
    void api<Space[]>('/spaces', {}, { signal: controller.signal }).then(spaces => {
        if (controller.signal.aborted) return;
        knowledgeOptionsLoaded = true;
        knowledgeSpaces = spaces;
        renderKnowledgeSources();
    }).catch(error => {
        if (!controller.signal.aborted && view === 'search' && select('search-mode').value === 'knowledge') showFailure('search-status', error);
    }).finally(() => {
        if (controllers.get('knowledge-options') === controller) controllers.delete('knowledge-options');
    });
}

function knowledgeSearch(query: string) {
    if (!query) return;
    const scopes: object[] = knowledgePinned ? [knowledgePinned] : Array.from(select('knowledge-sources').selectedOptions, option => {
        const [kind, id] = option.value.split('/');
        return kind === 'space' ? { kind, spaceId: id } : { kind, projectId: id };
    });
    if (!scopes.length || scopes.length > 8) {
        report('search-status', scopes.length ? 'KNOWLEDGE_SCOPE_TOO_LARGE' : 'knowledgeScopeRequired', '', 'warning');
        return;
    }
    resetSearchResults();
    void run('search', async signal => {
        try { return await api<KnowledgeResults>('/search/knowledge', {}, jsonRequest({ query, scopes }, 'POST', signal)); }
        catch (error) {
            if (error instanceof RequestError && error.code === 'KNOWLEDGE_SEARCH_UNAVAILABLE') return error.details as KnowledgeResults;
            throw error;
        }
    }, result => {
        knowledgeResults = result;
        renderSearchResults();
        if (result.status === 'FAILED') report('search-status', 'KNOWLEDGE_SEARCH_UNAVAILABLE', '', 'error');
        else if (result.status === 'PARTIAL') report('search-status', 'knowledgePartial', String(result.results.length), 'warning');
        else if (result.results.length) report('search-status', 'matches', String(result.results.length));
        else report('search-status', 'noResults');
    });
}

function resetSearchResults() {
    searchHits = [];
    searchPreview = 0;
    knowledgeResults = undefined;
    nextPage = undefined;
    element('next').hidden = true;
    renderSearchResults();
}

function search(append = false) {
    const query = element<HTMLTextAreaElement>('query').value.trim();
    const mode = select('search-mode').value;
    if (mode === 'knowledge') { knowledgeSearch(query); return; }
    const scope = select('search-scope').value;
    if (!query || (scope === 'current' && !selected)) {
        if (!selected && scope === 'current') report('search-status', 'pickFirst', '', 'warning');
        return;
    }
    const args: Record<string, string> = { [mode === 'code' ? 'snippet' : 'q']: query };
    if (scope === 'current') args.projectId = selected;
    const page = append ? nextPage : { path: `/search/${scope === 'all' ? 'authorized/' : ''}${mode}`, args, offset: 0 };
    if (!page) return;
    const params = { ...page.args };
    if (page.path.endsWith('/semantic') || page.path.endsWith('/code')) params.offset = String(page.offset);
    if (!append) {
        searchHits = [];
        searchPreview = 0;
        renderSearchResults();
    }
    element('next').hidden = true;
    void run('search', signal => api<Hit[] | { results: Hit[]; hasMore?: boolean }>(page.path, params, { signal }), result => {
        const hits = normalizeResults(result);
        searchHits.push(...hits);
        renderSearchResults();
        nextPage = !Array.isArray(result) && result.hasMore ? { ...page, offset: page.offset + hits.length } : undefined;
        element('next').hidden = !nextPage;
        if (searchHits.length) report('search-status', 'matches', String(searchHits.length));
        else report('search-status', 'noResults');
    });
}
function previewCard(hit: Hit) {
    const panel = card(hit);
    const source = hit.unit.rawSource;
    if (source) {
        const excerpt = el('pre', source.split('\n', 18).join('\n'), 'source-preview');
        excerpt.tabIndex = 0;
        panel.append(excerpt);
    }
    return panel;
}

function renderSearchResults() {
    const container = element('search-results');
    const overview = element<HTMLDetailsElement>('knowledge-coverage');
    overview.hidden = !knowledgeResults;
    if (knowledgeResults) {
        const { coverage, results, status } = knowledgeResults;
        overview.open = status !== 'COMPLETE';
        const projectName = (id: string) => projects.find(project => project.projectId === id)?.projectName ?? id;
        const spaceName = (id: string) => knowledgeSpaces.find(space => space.id === id)?.name ?? id.slice(0, 8);
        element('knowledge-coverage-list').replaceChildren(...coverage.map(item => el('li', [t('knowledge:' + item.kind),
            item.projectId && projectName(item.projectId), (item.versionId ?? item.snapshotId)?.slice(0, 8),
            item.spaceIds.map(spaceName).join(', '), t('knowledge:' + item.status), ...item.omissions.map(t)].filter(Boolean).join(' · '))));
        const list = el('div', '', 'knowledge-result-list');
        for (const hit of results) {
            const card = el('article', '', 'surface result');
            const title = el('a', hit.title) as HTMLAnchorElement;
            title.href = hit.link;
            const heading = el('h2');
            heading.append(title);
            const lines = hit.startLine > 0 ? 'L' + hit.startLine + (hit.endLine > hit.startLine ? '–' + hit.endLine : '') : '';
            const location = hit.kind === 'SOURCE' ? [hit.archiveEntry ?? hit.filePath, hit.snapshotId.slice(0, 8)]
                : hit.kind === 'WIKI' ? [t(hit.perspective), hit.snapshotId.slice(0, 8), hit.revisionId.slice(0, 8)]
                    : [hit.versionId.slice(0, 8), hit.page && t('spacePdfPage') + ' ' + hit.page, hit.cell && cellLabel(hit.cell)];
            card.append(heading, el('p', [t('knowledge:' + hit.kind), ...location, lines, ...hit.spaceIds.map(spaceName),
                ...hit.methods.map(t), hit.kind === 'SOURCE' && hit.binary && t('knowledgeBinary'),
                hit.truncated && t('knowledgeExcerpt')].filter(Boolean).join(' · '), 'kind'));
            if (hit.excerpt) card.append(el('pre', hit.excerpt, 'source-preview'));
            list.append(card);
        }
        container.replaceChildren(...results.length ? [list] : []);
        return;
    }
    element('knowledge-coverage-list').replaceChildren();
    if (!searchHits.length) {
        container.replaceChildren();
        return;
    }
    const list = el('div', '', 'surface search-match-list');
    const detail = el('div', '', 'search-preview');
    const buttons: HTMLButtonElement[] = [];
    const show = (index: number) => {
        searchPreview = index;
        for (const [position, button] of buttons.entries()) {
            button.setAttribute('aria-pressed', String(position === index));
        }
        detail.replaceChildren(previewCard(searchHits[index]));
    };
    searchHits.forEach((hit, index) => {
        const button = el('button', '', 'search-match') as HTMLButtonElement;
        button.type = 'button';
        button.append(el('strong', hit.unit.qualifiedName),
            el('span', locationLabel(hit.unit, hit.projectId, hit.unit.metadata.archive_entry), 'mono'));
        button.addEventListener('click', () => show(index));
        buttons.push(button);
        list.append(button);
    });
    show(searchPreview);
    container.replaceChildren(list, detail);
}

function graphSvg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    return node;
}

function renderGraphDiagram(data: GraphDiagram, relation: string, projectId: string, snapshotId?: string) {
    const group = el('section', '', 'graph-diagram');
    const frame = el('div', '', 'graph-viewport');
    const details = el('div', '', 'graph-preview');
    const units = new Map([data.root, ...data.members, ...data.results].map(unit => [unit.id, unit]));
    const upstream = relation !== 'callees';
    const levels: string[][] = [[data.root.id, ...data.members.map(unit => unit.id)]];
    for (const edge of data.connections) {
        (levels[edge.depth] ??= []).push(upstream ? edge.source : edge.target);
    }
    const width = Math.max(...levels.map(row => row.length)) * 172 + 24;
    const height = levels.length * 84 + 16;
    if (upstream) levels.reverse();
    const points = new Map<string, [number, number]>();
    levels.forEach((row, level) => row.forEach((id, column) => {
        points.set(id, [(column + .5) * width / row.length, 50 + level * 84]);
    }));

    const svg = graphSvg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': t('graphDiagram') });
    const defs = graphSvg('defs', {});
    for (const name of ['normal', 'selected']) {
        const arrow = graphSvg('marker', { id: `graph-arrow-${name}`, markerWidth: 7, markerHeight: 7, refX: 6, refY: 3.5, orient: 'auto' });
        arrow.append(graphSvg('path', { d: 'M0 0L7 3.5L0 7Z', class: `graph-arrow-${name}` }));
        defs.append(arrow);
    }
    svg.append(defs);
    const paths = data.connections.map(({ source, target }) => {
        const [x, y] = points.get(source)!;
        const [dx, dy] = points.get(target)!;
        const middle = (y + dy) / 2;
        const line = graphSvg('path', { d: `M${x} ${y + 17} C${x} ${middle} ${dx} ${middle} ${dx} ${dy - 19}`, class: 'graph-edge' });
        svg.append(line);
        return { source, target, line };
    });
    const buttons = new Map<string, HTMLButtonElement>();
    const show = (id: string) => {
        for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
        for (const { source, target, line } of paths) {
            const active = source === id || target === id;
            line.classList.toggle('selected', active);
            line.setAttribute('marker-end', active ? 'url(#graph-arrow-selected)' : 'url(#graph-arrow-normal)');
        }
        details.replaceChildren(previewCard({ unit: units.get(id)!, projectId, snapshotId }));
    };
    for (const [id, [x, y]] of points) {
        const unit = units.get(id)!;
        const box = graphSvg('foreignObject', { x: x - 77, y: y - 18, width: 154, height: 36 });
        const button = el('button', unit.simpleName || unit.qualifiedName, 'graph-node') as HTMLButtonElement;
        button.type = 'button';
        button.title = unit.qualifiedName;
        button.setAttribute('aria-label', unit.qualifiedName);
        button.addEventListener('click', () => show(id));
        buttons.set(id, button);
        box.append(button);
        svg.append(box);
    }
    frame.tabIndex = 0;
    frame.setAttribute('aria-label', t('graphDiagram'));
    frame.append(svg);
    const toolbar = el('header', '', 'graph-toolbar');
    const tools = el('div', '', 'graph-tools');
    const output = el('output', '100%');
    const zoomButton = (label: string, icon: string, action: () => void) => {
        const button = resultButton(label, action);
        button.className = 'icon-button';
        button.setAttribute('aria-label', t(label));
        button.title = t(label);
        button.replaceChildren(workbenchIcon(icon));
        return button;
    };
    let scale = 1;
    const zoom = (next: number) => {
        scale = Math.max(.5, Math.min(2, next));
        svg.setAttribute('width', String(width * scale));
        svg.setAttribute('height', String(height * scale));
        output.textContent = `${Math.round(scale * 100)}%`;
        less.disabled = scale === .5;
        more.disabled = scale === 2;
    };
    const less = zoomButton('graphZoomOut', 'zoom-out', () => zoom(scale - .25));
    const more = zoomButton('graphZoomIn', 'zoom-in', () => zoom(scale + .25));
    tools.append(less, output, more, zoomButton('graphZoomReset', 'refresh', () => {
        zoom(1);
        frame.scrollTo(0, 0);
    }));
    frame.addEventListener('wheel', event => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        zoom(scale - Math.sign(event.deltaY) * .05);
    }, { passive: false });
    let drag: { x: number; y: number; left: number; top: number } | undefined;
    frame.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as Element).closest('button')) return;
        drag = { x: event.clientX, y: event.clientY, left: frame.scrollLeft, top: frame.scrollTop };
        frame.setPointerCapture(event.pointerId);
        frame.classList.add('panning');
    });
    frame.addEventListener('pointermove', event => {
        if (drag) frame.scrollTo(drag.left + drag.x - event.clientX, drag.top + drag.y - event.clientY);
    });
    frame.addEventListener('lostpointercapture', () => {
        drag = undefined;
        frame.classList.remove('panning');
    });
    toolbar.append(el('h2', t('graphDiagram')), tools);
    const map = el('div', '', 'surface graph-map');
    map.append(toolbar, frame);
    if (data.results.length > data.connections.length) map.append(el('p', t('graphDiagramLimit'), 'hint'));
    group.append(map, details);
    show(data.root.id);
    return group;
}

function renderGraphResults(state: NonNullable<typeof graphView>) {
    const { data, relation, target, projectId, snapshotId } = state;
    const container = element('graph-results');
    const list = el('details', '', 'surface relationship graph-relation-list') as HTMLDetailsElement;
    const heading = el('summary', data.connections.length ? t('graphRelationshipList') : t('graphDiagram'));
    const label = el('h2', `${t(relation)} ${relation === 'callees' ? '→' : '←'} ${data.root.qualifiedName || target}`, 'relationship-title');
    const nodes = el('div', '', 'results');
    nodes.append(card({ unit: data.root, projectId, snapshotId }), ...data.results.map(unit => card({ unit, projectId, snapshotId })));
    list.append(heading, label, nodes);
    list.open = window.matchMedia('(max-width: 980px)').matches || !data.connections.length;
    container.replaceChildren(renderGraphDiagram(data, relation, projectId, snapshotId), list);
}

function renderGraphScope() {
    element('graph-snapshot').hidden = graphSnapshot === undefined;
    element('graph-snapshot-id').textContent = `${t('frozenKnowledgeSnapshot')} · ${graphSnapshot ?? ''}`;
    element<HTMLAnchorElement>('graph-current-link').href = route('graph', selected);
    element<HTMLButtonElement>('flow-analyze').disabled = graphSnapshot !== undefined;
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
    const snapshotId = graphSnapshot;
    flowView = undefined;
    graphView = undefined;
    element('graph-results').replaceChildren();
    void run('graph', signal => api<GraphDiagram | null>(`/graph/${relation}`, {
        target, depth, projectId, diagram: 'true', ...(snapshotId !== undefined ? { snapshotId } : {})
    }, { signal }), data => {
        if (!data) {
            report('graph-status', 'noResults');
            return;
        }
        report('graph-status', data.results.length ? 'matches' : 'graphNoNeighbors', data.results.length ? String(data.results.length) : '');
        graphView = { data, relation, target, projectId, snapshotId };
        renderGraphResults(graphView);
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
    graphView = undefined;
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
function locate(file: string, line: number, project: string, archiveEntry?: string, symbol?: string) {
    if (!project) {
        report('locate-status', 'pickFirst', '', 'warning');
        return;
    }
    const snapshotId = graphSnapshot;
    void run('locate', signal => api<CodeUnit>('/locate', {
        ...indexedLocation(file, line, /\.jar$/i.test(file) ? archiveEntry : undefined), projectId: project,
        ...(snapshotId !== undefined ? { snapshotId, ...(symbol ? { symbol } : {}) } : {})
    }, { signal }), unit => {
        report('locate-status');
        showSource(unit, project, snapshotId);
    });
}
function loadEvidenceSnapshots(requested: string | null) {
    const picker = select('evidence-snapshot');
    const submit = element<HTMLFormElement>('evidence-form').querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const projectId = selected;
    picker.replaceChildren(new Option(t('evidenceLiveIndex'), ''));
    element('evidence-snapshot-control').hidden = true;
    submit.disabled = Boolean(projectId);
    if (!projectId) return;
    void run('evidence-snapshots', async signal => {
        const snapshots = await api<WikiSnapshot[]>('/knowledge-snapshots', { projectId, limit: '100' }, { signal });
        if (isUuid(requested) && !snapshots.some(snapshot => snapshot.id === requested)) {
            snapshots.push(await api<WikiSnapshot>('/knowledge-snapshots/' + requested, { projectId }, { signal }));
        }
        return snapshots;
    }, snapshots => {
        report('evidence-snapshots-status');
        submit.disabled = false;
        if (!snapshots.length) return;
        for (const snapshot of snapshots) picker.add(new Option(new Date(snapshot.publishedAt).toLocaleString(language)
            + ' · ' + snapshot.id.slice(0, 8), snapshot.id));
        picker.value = isUuid(requested) ? requested : requested === 'live' ? '' : snapshots[0].id;
        element('evidence-snapshot-control').hidden = false;
    });
}

function buildPack() {
    const q = input('evidence-query').value.trim();
    if (!selected) {
        report('evidence-status', 'pickFirst', '', 'warning');
        return;
    }
    if (!q) return;
    if (element<HTMLFormElement>('evidence-form').querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled) return;
    const snapshotId = select('evidence-snapshot').value;
    history.replaceState(null, '', route('evidence', selected, { snapshotId: snapshotId || 'live' }));
    element('evidence-results').replaceChildren();
    void run('evidence', signal => api<Pack>('/context/pack', {
        q, projectId: selected, budgetChars: input('budget').value, ...(snapshotId ? { snapshotId } : {})
    }, { signal }), result => {
        report('evidence-status', 'excerptBudget', () => [
            `${formatNumber(result.usedBudgetChars)}/${formatNumber(result.requestedBudgetChars)}`, ...result.omittedReasons.map(diagnostic)
        ].join(' · '), result.omittedReasons.length ? 'warning' : undefined);
        element('evidence-results').replaceChildren(...result.evidence.map(evidence => {
            const item = el('article', '', 'surface result');
            const header = el('div', '', 'result-top');
            const label = el('div');
            label.append(el('h2', `${evidence.citationId} · ${evidence.qualifiedName}`),
                el('p', locationLabel(evidence, evidence.projectId, evidence.archiveEntry), 'mono'));
            const action = evidence.startLine <= 0 ? 'graph' : evidence.bytecode ? 'openSignature' : 'openSource';
            header.append(label, resultButton(action, () => {
                const destination = evidence.startLine > 0 ? indexedLocation(evidence.filePath, evidence.startLine, evidence.archiveEntry)
                    : { target: evidence.unitId ?? evidence.qualifiedName };
                navigate('graph', evidence.projectId, { ...destination,
                    ...(evidence.snapshotId ? { snapshotId: evidence.snapshotId, ...(evidence.startLine > 0 ? { symbol: evidence.qualifiedName } : {}) } : {}) });
            }));
            item.append(header, el('span', () => [t(evidence.kind), t(evidence.source), t(evidence.relation),
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
    loadAdminTab(adminTabs.active);
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

function loadAdminTab(panel: string) {
    if (!connected || view !== 'admin') return;
    if (panel === 'provider-panel') loadProviders();
    else {
        input('provider-key').value = '';
        controllers.get('provider-write')?.abort();
    }
    if (panel === 'diagnostics-panel') loadOperations();
}

let operations: OperationsReport | undefined;

function loadOperations() {
    if (account?.role !== 'ADMIN') return;
    void run('operations', signal => api<OperationsReport>('/admin/diagnostics', {}, { signal }), result => {
        operations = result;
        renderOperations(result);
        report('operations-status');
    });
}

function renderOperations(data: OperationsReport) {
    const content = element('operations-content');
    const { generation, workers, metrics, ...components } = data.components;
    const rows = Object.entries(components);
    if (metrics) rows.push(['metrics', metrics.available ? 'available' : 'unavailable']);
    rows.push(['generation', generation.status], ...Object.entries(workers).map(([name, worker]): [string, string] => [name, worker.status]));
    content.replaceChildren(
        el('p', `${t('ops:' + data.status)} · ${new Date(data.observedAt).toLocaleString(language)}`, 'kind'),
        qualityTable(['operationsComponent', 'status'], rows.map(([name, state]) => [t('ops:' + name), t('ops:' + state)]))
    );
    if (data.activity) {
        const { requests, queue } = data.activity;
        content.append(el('p', `${t('operationsResponses')} · 202 ${formatNumber(requests.accepted)} · 4xx ${formatNumber(requests.clientError)} · 5xx ${formatNumber(requests.serverError)}`, 'hint'));
        if (queue.length) {
            const scroll = el('div', '', 'operations-table');
            scroll.append(qualityTable(['operationsQueue', 'status', 'count', 'operationsLeases', 'operationsReadyAge'], queue.map(row => [
                t(String(row.kind)), t(String(row.state)), String(row.count), String(row.expiredLeases),
                row.oldestReadyAgeMs === null ? '—' : formatNumber(row.oldestReadyAgeMs / 1000, 1)
            ])));
            content.append(scroll);
        }
    }
    content.hidden = false;
}

function lookupOperations() {
    if (account?.role !== 'ADMIN') return;
    const kind = select('operations-kind').value;
    const id = input('operations-id').value.trim();
    const result = element('operations-lookup-result');
    result.hidden = true;
    if (!isUuid(id)) { report('operations-lookup-status', 'operationsInvalidId', '', 'warning'); return; }
    void run('operations-lookup', signal => api<unknown>(`/admin/diagnostics/${kind}/${id}`, {}, { signal }), details => {
        result.textContent = JSON.stringify(details, null, 2);
        result.hidden = false;
        report('operations-lookup-status');
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
    input('provider-concurrency').value = String(profile?.pool?.maxConcurrent ?? 4);
    input('provider-reserved-ask').value = String(profile?.pool?.reservedAsk ?? 0);
    input('provider-reserved-ask').max = String(input('provider-concurrency').valueAsNumber - 1);
    const window = profile?.pool?.backgroundWindow;
    input('provider-window-enabled').checked = Boolean(window);
    input('provider-window-zone').value = window?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    input('provider-window-start').value = window?.start ?? '09:00';
    input('provider-window-end').value = window?.end ?? '18:00';
    renderWeekdays('provider-window-days', window?.weekdays ?? [0, 1, 2, 3, 4, 5, 6]);
    updateProviderWindowFields();
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
    const backgroundWindow = input('provider-window-enabled').checked
        ? { timeZone: input('provider-window-zone').value.trim(), start: input('provider-window-start').value,
            end: input('provider-window-end').value, weekdays: [...document.querySelectorAll<HTMLInputElement>('#provider-window-days input:checked')]
                .map(day => Number(day.value)) } : null;
    return { providerId: select('provider-profile').value || null, name: input('provider-name').value,
        protocol: select('provider-protocol').value, baseUrl: input('provider-url').value, model: input('provider-model').value,
        apiKey: input('provider-key').value, clearApiKey: input('provider-clear-key').checked, enabled: input('provider-enabled').checked,
        timeoutMillis: input('provider-timeout').valueAsNumber, maxOutputTokens: input('provider-tokens').valueAsNumber,
        inputUsdPerMillionTokens: amount('provider-input-price'), outputUsdPerMillionTokens: amount('provider-output-price'),
        pool: { maxConcurrent: input('provider-concurrency').valueAsNumber, reservedAsk: input('provider-reserved-ask').valueAsNumber,
            backgroundWindow } };
}

function updateProviderWindowFields() {
    const enabled = input('provider-window-enabled').checked;
    element('provider-window-fields').hidden = !enabled;
    for (const id of ['provider-window-zone', 'provider-window-start', 'provider-window-end']) input(id).disabled = !enabled;
}

function renderAdministration(data: Administration, preserveOwner = false) {
    const { accounts, organizations, projects, audit } = data;
    element('account-list').replaceChildren(...accounts.map(entry => {
        const row = el('div');
        row.append(el('strong', `${entry.displayName} · ${entry.username}`), el('p', t(entry.status)));
        return row;
    }));
    element('audit-list').replaceChildren(...audit.map(event => {
        const row = el('div');
        const actor = accounts.find(entry => entry.id === event.actorId)?.username ?? event.actorId;
        row.append(el('strong', t(event.action)),
            el('p', [new Date(event.createdAt).toLocaleString(language), actor, event.reason].filter(Boolean).join(' · ')));
        return row;
    }));
    options('review-account', accounts.filter(entry => entry.role !== 'ADMIN').map(entry =>
        [entry.id, `${entry.username} · ${t(entry.status)}`]), 'chooseAccount');
    options('managed-org', organizations.map(entry => [entry.id, entry.name]), 'newOrganization');
    options('member-account', accounts.map(entry => [entry.id, entry.username]), 'chooseAccount');
    options('owner-project', projects.map(entry => [entry.project.projectId, entry.project.projectName]), 'choose');
    showReviewOptions();
    chooseOwnerProject(preserveOwner);
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
            ? result.map(entry => entry.username).join(', ') : () => t('noMembers'), 'hint'));
        selectedMembership();
        report('admin-members-status');
    });
}

function selectedMembership() {
    input('member-present').checked = organizationMembers.some(entry => entry.id === select('member-account').value);
}

function chooseOwnerProject(preserveOwner = false) {
    const project = administration?.projects.find(item => item.project.projectId === select('owner-project').value);
    const owner = project?.owner;
    const name = owner?.ownerType === 'PERSONAL'
        ? administration?.accounts.find(entry => entry.id === owner.ownerId)?.username
        : administration?.organizations.find(entry => entry.id === owner?.ownerId)?.name;
    element('current-owner').textContent = !project ? '' : owner ? `${t('owner')} · ${name ?? owner.ownerId}` : t('unassigned');
    if (!preserveOwner && owner) select('owner-type').value = owner.ownerType;
    ownerOptions(preserveOwner ? select('owner-target').value : owner?.ownerId);
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
element('ask-session-select').addEventListener('change', () => {
    const id = select('ask-session-select').value;
    navigate('ask', selected, id ? { session: id } : {});
});
form('ask-create', () => {
    if (controllers.has('ask-write')) return;
    const params = new URL(location.href).searchParams;
    const snapshotId = params.get('snapshotId');
    const scopes = [...Array.from(select('ask-projects').selectedOptions, option => ({ projectId: option.value,
        ...(isUuid(snapshotId) && selected === option.value ? { snapshotId } : {}) })),
    ...Array.from(select('ask-spaces').selectedOptions, option => ({ spaceId: option.value }))];
    const picker = input('ask-attachment-files');
    const files = Array.from(picker.files ?? []);
    if (!scopes.length && !files.length) { report('ask-write-status', 'askSelectScope', '', 'warning'); return; }
    if (files.length > 8 || files.some(file => file.size > 256 * 1024)
        || files.reduce((total, file) => total + file.size, 0) > 1024 * 1024) {
        report('ask-write-status', 'ASK_ATTACHMENT_CAPACITY_EXCEEDED', '', 'error');
        return;
    }
    const title = input('ask-session-title').value.trim();
    const selection = { scopes, ...(title ? { title } : {}), allowPartialSpaces: input('ask-partial-spaces').checked,
        lifetimeDays: Number(input('ask-retention').value) };
    void run('ask-write', async signal => {
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        const decoded = await Promise.all(files.map(async file => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (spaceImportType(file) === 'application/pdf') {
                let binary = '';
                for (const byte of bytes) binary += String.fromCharCode(byte);
                return { name: file.name, pdfBase64: btoa(binary) };
            }
            try { return { name: file.name, text: decoder.decode(bytes) }; }
            catch { throw new RequestError(400, 'ASK_ATTACHMENT_INVALID_TEXT'); }
        }));
        signal.throwIfAborted();
        const payload = { ...selection, ...(decoded.length ? { attachments: decoded } : {}) };
        const fingerprint = JSON.stringify(payload);
        if (askCreation?.fingerprint !== fingerprint) askCreation = { fingerprint, key: crypto.randomUUID() };
        return api<AskSessionView>('/ask/sessions', {}, { ...jsonRequest(payload, 'POST', signal),
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': askCreation.key } });
    }, result => {
        askCreation = undefined;
        picker.value = '';
        input('ask-session-title').value = '';
        navigate('ask', selected, { session: result.id });
    });
});
element('ask-attachment-dialog').addEventListener('close', () => {
    if (!element<HTMLDialogElement>('ask-attachment-dialog').open) closeAskAttachment();
});
select('ask-attachment-page').addEventListener('change', event => {
    displayAskPdfPage(Number((event.target as HTMLSelectElement).value));
});
form('ask-question-form', () => {
    if (!askSession || askCurrentTurn || controllers.has('ask-write')) return;
    const field = element<HTMLTextAreaElement>('ask-question');
    const question = field.value.trim();
    const sessionId = askSession.id;
    if (!question) return;
    if (askRequest?.sessionId !== sessionId || askRequest.question !== question) askRequest = { sessionId, question, key: crypto.randomUUID() };
    const key = askRequest.key;
    void run('ask-write', signal => {
        const init = jsonRequest({ question }, 'POST', signal);
        const headers = new Headers(init.headers);
        headers.set('Idempotency-Key', key);
        return api<{ turn: { id: string; status: string } }>(askUrl(sessionId) + '/turns', {}, { ...init, headers });
    }, result => {
        if (field.value.trim() === question) field.value = '';
        askRequest = undefined;
        if (['QUEUED', 'RUNNING'].includes(result.turn.status)) askCurrentTurn = result.turn.id;
        updateAskControls();
        report('ask-write-status');
        trackAsk(sessionId);
    });
});
element('ask-cancel').addEventListener('click', () => {
    if (!askSession || !askCurrentTurn || controllers.has('ask-write')) return;
    const id = askSession.id;
    const turn = askCurrentTurn;
    void run('ask-write', signal => api(askUrl(id) + '/turns/' + turn + '/cancel', {}, { method: 'POST', signal }), () => {
        report('ask-write-status');
        trackAsk(id);
    });
});
form('space-create', () => {
    const name = input('space-name').value.trim();
    if (!name) return;
    manageSpace(async signal => {
        const space = await api<Space>('/spaces', {}, jsonRequest({ name }, 'POST', signal));
        if (!signal.aborted) {
            input('space-name').value = '';
            openSpace(space.id);
        }
    }, () => {});
});
form('space-link', () => {
    const space = spaceState?.space;
    const projectId = select('space-repository').value;
    const snapshotId = select('space-link-snapshot').value;
    if (space && projectId) manageSpace(signal => api('/spaces/' + space.id + '/repositories', {},
        jsonRequest({ projectId, revision: space.revision, ...(snapshotId ? { snapshotId } : {}) }, 'POST', signal)));
});
select('space-repository').addEventListener('change', loadSpaceLinkSnapshots);
element('space-detached').addEventListener('toggle', loadDetachedSpaceRepositories);
element('space-deleted-list').addEventListener('toggle', loadDeletedSpaces);
element('space-settings-open').addEventListener('click', openSpaceSettings);
element('space-settings-refresh').addEventListener('click', () => {
    if (spaceSettingsId && !controllers.has('space-settings')) loadSpaceSettings(spaceSettingsId);
});
form('space-settings-limits', () => applySpaceSettings('', 'PATCH', {
    name: input('space-settings-input').value.trim(), maxRepositories: input('space-max-repositories').valueAsNumber,
    maxFileBytes: input('space-max-file-bytes').valueAsNumber, maxBytes: input('space-max-bytes').valueAsNumber
}));
form('space-add-member', () => {
    const username = input('space-member-username').value.trim();
    if (username) changeSpaceMember({ username, role: select('space-add-role').value });
});
element('space-delete').addEventListener('click', () => {
    if (!spaceSettings || !window.confirm(t('spaceDeleteConfirm'))) return;
    applySpaceSettings('', 'PATCH', { status: 'DELETED' }, () => {
        element<HTMLDialogElement>('space-settings').close();
        navigate('spaces', '');
        loadDeletedSpaces();
    });
});
element('space-settings').addEventListener('close', () => {
    controllers.get('space-settings')?.abort();
    const id = spaceSettingsId;
    spaceSettingsId = undefined;
    spaceSettings = undefined;
    element('space-member-list').replaceChildren();
    input('space-member-username').value = '';
    const params = new URL(location.href).searchParams;
    if (connected && view === 'spaces' && id === params.get('space')) loadSpaces(params);
});
element('space-move-current').addEventListener('click', () => browseSpaceDestination(undefined));
element('space-move-root').addEventListener('click', () => browseSpaceDestination([]));
element('space-move-up').addEventListener('click', () => browseSpaceDestination(spaceMove?.trail?.slice(0, -1)));
form('space-move-form', saveSpaceMove);
element('space-move').addEventListener('close', () => {
    for (const key of ['space-move', 'space-move-folders']) controllers.get(key)?.abort();
    spaceMove = undefined;
    input('space-move-name').value = '';
    element('space-move-folders').replaceChildren();
});
element('space-import-open').addEventListener('click', openSpaceImport);
select('space-import-mode').addEventListener('change', updateSpaceImport);
input('space-import-file').addEventListener('change', () => {
    const name = input('space-import-file').files?.[0]?.name;
    if (name) input('space-import-name').value = name;
    renderSpaceImportTargets();
});
element('space-import-reload').addEventListener('click', loadSpaceImportTargets);
form('space-import-form', importSpaceDocument);
element('space-import').addEventListener('close', () => {
    for (const key of ['space-import', 'space-import-targets']) controllers.get(key)?.abort();
    spaceImport = undefined;
    element<HTMLFormElement>('space-import-form').reset();
    select('space-import-target').replaceChildren();
});
for (const [control, status] of [['space-archive', 'ARCHIVED'], ['space-reactivate', 'ACTIVE']]) {
    element(control).addEventListener('click', () => {
        const space = spaceState?.space;
        if (space) manageSpace(signal => api('/spaces/' + space.id, {}, jsonRequest({ status, revision: space.revision }, 'PATCH', signal)));
    });
}
element('space-add-item').addEventListener('submit', event => {
    event.preventDefault();
    if ((event as SubmitEvent).submitter?.id === 'space-generate-document') { openSpaceGeneration(false); return; }
    const state = spaceState;
    const name = input('space-item-name').value.trim();
    if (!state || !name || controllers.has('space-action')) return;
    const folder = (event as SubmitEvent).submitter?.id !== 'space-add-document';
    const base = '/spaces/' + state.space.id;
    const placement = { parentId: state.folder, name };
    const id = base + '/documents' + JSON.stringify(placement);
    if (!folder && spaceSubmission?.input !== id) spaceSubmission = { input: id, key: crypto.randomUUID() };
    manageSpace(async signal => {
        const item = await api<SpaceItem>(base + (folder ? '/folders' : '/documents'), {},
            jsonRequest(folder ? placement : { ...placement, markdown: '', key: spaceSubmission!.key }, 'POST', signal));
        if (!signal.aborted) {
            input('space-item-name').value = '';
            if (!folder) spaceSubmission = undefined;
            openSpace(state.space.id, folder ? { folder: item.id } : { item: item.id, ...(state.folder ? { folder: state.folder } : {}) });
        }
    }, () => {});
});
const reloadSpaceSearch = (query = '') => {
    const state = spaceState;
    if (state) openSpace(state.space.id, { ...(state.folder ? { folder: state.folder } : {}), ...(query ? { q: query } : {}) });
};
form('space-search-form', () => reloadSpaceSearch(input('space-search').value.trim()));
element('space-clear-search').addEventListener('click', () => reloadSpaceSearch());
element('space-up').addEventListener('click', () => { if (spaceState) openSpace(spaceState.space.id); });
element('space-markdown').addEventListener('input', event => {
    if (spaceDocument?.mediaType === 'text/markdown') spaceDrafts.set(spaceDraftKey(spaceDocument), (event.target as HTMLTextAreaElement).value);
});
element('space-csv-previous').addEventListener('click', () => { if (spaceCsv) showSpaceCsvRow(spaceCsv.start - csvRowsPerPage + 1); });
element('space-csv-next').addEventListener('click', () => { if (spaceCsv) showSpaceCsvRow(spaceCsv.start + csvRowsPerPage + 1); });
input('space-csv-row').addEventListener('change', event => showSpaceCsvRow(Number((event.target as HTMLInputElement).value)));
input('space-csv-row').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    showSpaceCsvRow(Number((event.target as HTMLInputElement).value));
});
element('space-csv-cell').addEventListener('input', event => {
    const document = spaceDocument;
    const cell = spaceCsv?.cell;
    if (!document?.csvRows || !cell || !spaceCsv?.writable) return;
    const original = document.csvRows[cell.row - 1][cell.column - 1];
    const entered = (event.target as HTMLTextAreaElement).value;
    const draftKey = spaceDraftKey(document);
    const drafts = spaceCsvDrafts.get(draftKey) ?? new Map<string, CellEdit>();
    const key = cellKey(cell);
    if (normalizeMarkdown(original) === entered) drafts.delete(key);
    else {
        const ending = original.match(/\r\n|\r|\n/)?.[0] ?? '\n';
        drafts.set(key, { ...cell, value: entered.replaceAll('\n', ending) });
    }
    if (drafts.size) spaceCsvDrafts.set(draftKey, drafts);
    else spaceCsvDrafts.delete(draftKey);
    const button = csvCellButton(cell);
    if (button) button.textContent = drafts.get(key)?.value ?? original;
    element<HTMLButtonElement>('space-save').disabled = !drafts.size;
});
select('space-pdf-page').addEventListener('change', event => {
    if (!spaceDocument?.pdfPages) return;
    const page = Number((event.target as HTMLSelectElement).value);
    displaySpacePdfPage(spaceDocument.pdfPages, page);
    const destination = new URL(location.href);
    destination.searchParams.set('revision', spaceDocument.version.id);
    destination.searchParams.set('page', String(page));
    destination.searchParams.delete('line');
    history.replaceState(history.state, '', destination);
});
select('space-version').addEventListener('change', event => {
    if (!spaceDocument || !spaceState) return;
    const revision = (event.target as HTMLSelectElement).value;
    openSpace(spaceDocument.spaceId, { item: spaceDocument.id, revision, ...(spaceState.folder ? { folder: spaceState.folder } : {}) });
});
form('space-editor', () => saveSpaceDocument(false));
form('space-generation-form', generateSpaceDocument);
element('space-generate-revision').addEventListener('click', () => openSpaceGeneration(true));
element('space-generation').addEventListener('close', () => {
    controllers.get('space-generation')?.abort();
    spaceGenerationTarget = undefined;
    element<HTMLTextAreaElement>('space-generation-instruction').value = '';
    element('space-generation-result').replaceChildren();
    report('space-generation-status');
    if (view === 'spaces' && connected) loadSpaces(new URL(location.href).searchParams);
});
element('space-latest').addEventListener('click', () => {
    if (spaceDocument && spaceState) openSpace(spaceDocument.spaceId, {
        item: spaceDocument.id, ...(spaceState.folder ? { folder: spaceState.folder } : {})
    });
});
element('space-restore-version').addEventListener('click', () => saveSpaceDocument(true));
element('space-export').addEventListener('click', () => {
    const document = spaceDocument;
    if (!document) return;
    void run('space-document', signal => api<Blob>('/spaces/' + document.spaceId + '/documents/' + document.id
        + '/versions/' + document.version.id + '/export', {}, { signal }, 'blob'), content => {
        report('space-document-status');
        const extension = document.pdfPages ? '.pdf' : document.csvRows ? '.csv' : '.md';
        const filename = document.name.toLowerCase().endsWith(extension) ? document.name : document.name + extension;
        download(filename, content, content.type);
    });
});
element('benchmark-refresh').addEventListener('click', () => void loadBenchmark());
element('wiki-generate').addEventListener('click', () => void trackWiki());
element('wiki-rebuild').addEventListener('click', () => void trackWiki(undefined, undefined, 'full'));
form('wiki-schedule-form', () => {
    const start = new Date(input('wiki-start-time').value);
    if (Number.isFinite(start.valueOf())) void trackWiki(undefined, start.toISOString());
});
element('wiki-job-pause').addEventListener('click', () => void controlWiki('pause'));
element('wiki-job-resume').addEventListener('click', () => void controlWiki('resume'));
element('wiki-job-cancel').addEventListener('click', () => void controlWiki('cancel'));
select('wiki-snapshot-select').addEventListener('change', () => {
    const snapshotId = select('wiki-snapshot-select').value;
    const perspective = wikiScope?.perspective ?? 'technical';
    navigate('wiki', selected, { perspective, ...(snapshotId ? { snapshotId } : {}) });
});
element<HTMLDetailsElement>('wiki-settings').addEventListener('toggle', event => {
    if ((event.currentTarget as HTMLDetailsElement).open && wikiSettingsTabs.active === 'wiki-snapshot-management') loadWikiLifecycle();
});
element('wiki-older-retired').addEventListener('click', () => loadWikiLifecycle(true));
select('wiki-retired-snapshot').addEventListener('change', updateWikiRetiredActions);
element('wiki-retire-snapshot').addEventListener('click', () => changeWikiLifecycle('retire'));
element('wiki-restore-snapshot').addEventListener('click', () => changeWikiLifecycle('restore'));
element('wiki-purge-snapshot').addEventListener('click', () => changeWikiLifecycle('purge'));
element<HTMLDetailsElement>('wiki-artifacts').addEventListener('toggle', event => {
    if ((event.currentTarget as HTMLDetailsElement).open) loadWikiArtifacts();
});
element('wiki-more-artifacts').addEventListener('click', () => loadWikiArtifacts(true));
form('wiki-artifact-form', prepareWikiArtifact);
select('wiki-perspective').addEventListener('change', () => {
    const perspective = select('wiki-perspective').value;
    const snapshotId = wikiScope?.source;
    const pagePath = wikiSummary?.tree.find(item => item.id === wikiSummary?.document.id)?.path;
    navigate('wiki', selected, { perspective, ...(snapshotId ? { snapshotId } : {}), ...(pagePath ? { pagePath } : {}) });
});
select('wiki-select').addEventListener('change', () => {
    const id = select('wiki-select').value;
    if (wikiSummary) select('wiki-select').value = wikiSummary.document.id;
    const runId = new URL(location.href).searchParams.get('run');
    navigate('wiki', selected, { document: id, perspective: wikiScope?.perspective ?? 'technical', ...(isUuid(runId) ? { run: runId } : {}) });
});
select('wiki-revision').addEventListener('change', () => {
    const doc = wikiSummary?.document;
    if (!doc) return;
    navigate('wiki', selected, { ...wikiPageParams(doc), revisionId: select('wiki-revision').value });
});
element('wiki-older-revisions').addEventListener('click', loadOlderWikiRevisions);
element('wiki-open-edit').addEventListener('click', openWikiEditor);
element('wiki-close-edit').addEventListener('click', () => { element('wiki-edit-form').hidden = true; });
element('wiki-save-draft').addEventListener('click', () => editWiki(true));
form('wiki-edit-form', () => editWiki(false));
form('wiki-search-form', searchWiki);
element('wiki-restore-revision').addEventListener('click', () => {
    const reading = wikiSummary;
    const selectedRevision = reading?.document.revision;
    const current = reading?.revisions.revisions[0];
    if (!reading || !selectedRevision || !current || current.id === selectedRevision.id) return;
    writeWiki<WikiDocument>(reading, `/revisions/${selectedRevision.id}/restore`, { baseRevisionId: current.id }, showPublishedWiki);
});
form('wiki-propose-form', () => {
    const reading = wikiSummary;
    const current = reading && currentWikiRevision(reading);
    const instruction = element<HTMLTextAreaElement>('wiki-draft-instruction').value.trim();
    if (!reading || !current || !instruction) return;
    writeWiki<WikiDraftListing>(reading, '/drafts/generate', { baseRevisionId: current.id, instruction }, draft => {
        element<HTMLTextAreaElement>('wiki-draft-instruction').value = '';
        showSavedWikiDraft(reading, draft);
    });
});
select('wiki-draft-select').addEventListener('change', () => selectWikiDraft(select('wiki-draft-select').value));
element('wiki-apply-draft').addEventListener('click', () => reviewWikiDraft('apply'));
element('wiki-discard-draft').addEventListener('click', () => reviewWikiDraft('discard'));
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
    element('nav-scrim').hidden = !opened;
    element('workspace-app').inert = opened;
    if (opened) (document.querySelector<HTMLElement>('nav a[aria-current]') ?? element('sidebar').querySelector('a'))?.focus();
});
element('collapse-nav').addEventListener('click', () => {
    sidebarCollapsed = !sidebarCollapsed;
    preference('sidebar', sidebarCollapsed ? 'compact' : 'full');
    renderSidebar();
});
element('nav-scrim').addEventListener('click', () => {
    closeMenu();
    element('menu').focus();
});
window.matchMedia('(max-width: 980px)').addEventListener('change', event => {
    closeMenu();
    const list = document.querySelector<HTMLDetailsElement>('.graph-relation-list');
    if (event.matches && list) list.open = true;
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && element('sidebar').classList.contains('open')) {
        closeMenu();
        element('menu').focus();
    }
});
document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const repository = target.closest<HTMLAnchorElement>('#view-repositories a[data-open-repository]');
    if (repository && !event.defaultPrevented && event.button === 0 && !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)) {
        event.preventDefault();
        navigate('overview', repository.dataset.openRepository);
    }
    for (const menu of document.querySelectorAll<HTMLDetailsElement>('[data-dropdown][open]')) {
        if (!menu.contains(target)) menu.open = false;
        else if (target.closest('.popover-items button, .popover-items a')) {
            const returnFocus = menu.contains(document.activeElement);
            menu.open = false;
            if (returnFocus) menu.querySelector('summary')?.focus();
        }
    }
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target instanceof Element) {
        const menu = event.target.closest<HTMLDetailsElement>('[data-dropdown][open]');
        if (menu) {
            menu.open = false;
            menu.querySelector('summary')?.focus();
        }
    }
    if (event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
    const reader = view === 'wiki' ? wikiReader : view === 'overview' ? architectureReader : undefined;
    if (reader?.openSearch()) event.preventDefault();
});
bindLanguageSwitch(next => { language = next; localize(); });
element('theme').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    preference('theme', theme);
    document.documentElement.dataset.theme = theme;
    renderThemeControl();
});
element('refresh').addEventListener('click', () => void refreshProjects());
element('project-trash').addEventListener('toggle', () => loadProjectTrash());
element('project-trash-refresh').addEventListener('click', () => loadProjectTrash());
element('project-trash-next').addEventListener('click', () => loadProjectTrash(true));
input('repo-filter').addEventListener('input', renderRepositoryList);
select('repo-kind').addEventListener('change', renderRepositoryList);
for (const filter of document.querySelectorAll<HTMLButtonElement>('[data-repo-status]')) {
    filter.addEventListener('click', () => {
        repositoryFilter = filter.dataset.repoStatus ?? 'all';
        renderRepositoryList();
    });
}
element('connect-repository').addEventListener('click', () => openRepositoryDialog(repositorySource));
element('index-section').addEventListener('close', () => {
    input('git-token').value = '';
    if (connected) (repositoryDialogOpener?.isConnected ? repositoryDialogOpener : element('connect-repository')).focus();
    repositoryDialogOpener = undefined;
});
select('git-connection').addEventListener('change', updateGitConnectionForm);
form('git-connect-form', connectGit);
element('git-sync').addEventListener('click', () => gitAction((repository, signal) =>
    api('/git/repositories/' + repository.projectId + '/sync', {}, jsonRequest({}, 'POST', signal))));
element('git-retry').addEventListener('click', () => gitAction((repository, signal) =>
    api('/git/repositories/' + repository.projectId + '/sync', {}, jsonRequest({ retryRunId: repository.latestSync?.runId }, 'POST', signal))));
element('git-cancel').addEventListener('click', () => gitAction((repository, signal) =>
    api('/agent-runs/' + repository.latestSync?.runId + '/execution', { projectId: repository.projectId },
        jsonRequest({ action: 'cancel', revision: repository.latestSync?.revision }, 'POST', signal))));
select('git-schedule-mode').addEventListener('change', syncGitScheduleFields);
form('git-automation-form', () => {
    const mode = select('git-schedule-mode').value;
    const weekdays = Array.from(document.querySelectorAll<HTMLInputElement>('#git-schedule-days input:checked'), day => Number(day.value));
    if (mode === 'calendar' && !weekdays.length) { report('git-action-status', 'gitScheduleSelectDay', '', 'warning'); return; }
    const calendar = mode === 'calendar' ? { timeZone: input('git-time-zone').value.trim(), localTime: input('git-local-time').value, weekdays } : null;
    gitAction((repository, signal) => api('/git/repositories/' + repository.projectId + '/automation', {}, jsonRequest({
        revision: repository.automation.revision, intervalMinutes: mode === 'interval' ? Number(input('git-interval').value) : null,
        calendar, eventEnabled: input('git-events').checked, publishAfterSync: input('git-auto-publish').checked
    }, 'PUT', signal)));
});
form('git-connection-form', () => {
    const current = gitSettings;
    if (!current || gitSettingsBusy()) return;
    const token = input('git-update-token').value;
    const secret = input('git-update-secret').value;
    const username = input('git-update-username').value;
    const clearToken = input('git-clear-token').checked;
    const clearSecret = input('git-clear-secret').checked;
    if ((token && clearToken) || (secret && clearSecret) || (username && !token)) {
        report('git-connection-save-status', 'gitConflictingCredential', '', 'error');
        return;
    }
    const enabled = input('git-connection-enabled').checked;
    if (enabled === current.enabled && !token && !secret && !clearToken && !clearSecret) return;
    input('git-update-token').value = '';
    input('git-update-secret').value = '';
    void run('git-connection-save', signal => api<GitConnection>('/git/connections/' + current.id, {}, jsonRequest({
        revision: current.revision, enabled, ...(token ? { credential: { token, ...(username ? { username } : {}) } } : clearToken ? { credential: null } : {}),
        ...(secret ? { eventSecret: secret } : clearSecret ? { eventSecret: null } : {})
    }, 'PATCH', signal)), () => {
        report('git-connection-save-status');
        loadGitSettings();
        if (selected) trackGitOverview(selected);
    });
});
form('git-reconnect-form', () => {
    const current = gitSettings;
    if (!current || gitSettingsBusy()) return;
    const adapter = select('git-reconnect-adapter').value;
    const url = input('git-reconnect-url').value.trim();
    void run('git-reconnect', signal => api<GitConnection>('/git/connections/' + current.id + '/reconnect', {}, jsonRequest({
        revision: current.revision, url, ...(!current.hostedIdentity && adapter ? { adapter } : {})
    }, 'POST', signal)), connection => {
        if (gitSettings?.id !== connection.id) return;
        gitSettings = connection;
        report('git-reconnect-status', 'gitReconnectSaved', '', 'success');
        loadGitSettings();
        if (selected) trackGitOverview(selected);
    });
});
function gitSettingsBusy() {
    return ['git-connection-save', 'git-reconnect', 'git-disconnect'].some(key => controllers.has(key));
}
element('git-disconnect').addEventListener('click', () => {
    const current = gitSettings;
    if (!current || gitSettingsBusy() || !window.confirm(t('gitDisconnectConfirm'))) return;
    input('git-update-token').value = '';
    input('git-update-secret').value = '';
    void run('git-disconnect', signal => api<GitConnection>('/git/connections/' + current.id, { revision: String(current.revision) },
        { method: 'DELETE', signal }), connection => {
        if (gitSettings?.id !== connection.id) return;
        gitSettings = connection;
        report('git-disconnect-status', 'gitDisconnected', '', 'success');
        loadGitSettings();
        if (selected) trackGitOverview(selected);
    });
});
element('overview-wiki').addEventListener('click', () => navigate('wiki'));
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
    architectureReader?.clear();
    architectureReader = undefined;
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
        report('finding-import-status', 'findingImported', () => [formatNumber(result.imported),
            `${t('findingDuplicates')} ${formatNumber(result.duplicates)}`, `${t('findingSkipped')} ${formatNumber(skipped)}`].join(' · '),
        skipped ? 'warning' : 'success');
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
        const units = kind === 'code' ? 'codeScanChecked' : 'taintScanChecked';
        report('inventory-scan-status', label, () => `${t(units)} ${formatNumber(checked)} · ${t('codeScanNew')} ${formatNumber(found)}`,
            partial ? 'warning' : 'success');
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
select('change-source').addEventListener('change', syncChangeSource);
element('change-form').addEventListener('submit', event => {
    event.preventDefault();
    const projectId = selected;
    if (!projectId) { report('change-status', 'pickFirst', '', 'warning'); return; }
    const diff = element<HTMLTextAreaElement>('change-diff');
    const source = select('change-source').value;
    const base = select('change-base-snapshot');
    const target = select('change-target-snapshot');
    if ((source === 'published' && (target.disabled || !isUuid(target.value)))
        || (source === 'working' && (base.disabled || !isUuid(base.value)))) {
        report('change-status', 'changeVersionsEmpty', '', 'warning');
        return;
    }
    const pathsField = element<HTMLTextAreaElement>('change-paths');
    const paths = pathsField.value.split(/\r?\n/).filter(path => path.trim());
    if (source === 'working' && (!paths.length || paths.length > 24 || new Set(paths).size !== paths.length)) {
        report('change-status', 'changeWorkingPathsInvalid', '', 'warning');
        return;
    }
    const payload = source === 'working' ? { projectId, baseSnapshotId: base.value, paths }
        : source === 'published' ? { projectId, targetSnapshotId: target.value,
            ...(base.value ? { baseSnapshotId: base.value === 'full' ? null : base.value } : {}) }
            : { projectId, diff: diff.value, baseVersion: input('change-base').value, targetVersion: input('change-target').value, source: 'workbench' };
    const fingerprint = JSON.stringify(payload);
    if (source !== 'diff' && changeComparisonRequest?.fingerprint !== fingerprint) {
        changeComparisonRequest = { fingerprint, key: crypto.randomUUID() };
    }
    const key = source !== 'diff' ? changeComparisonRequest!.key : undefined;
    const path = source === 'working' ? '/change-reviews/working-copy'
        : source === 'published' ? '/change-reviews/compare' : '/change-reviews';
    loadChangeReview(null);
    void run('change', signal => {
        const request = jsonRequest(payload, 'POST', signal);
        if (key) {
            const headers = new Headers(request.headers);
            headers.set('Idempotency-Key', key);
            request.headers = headers;
        }
        return api<ChangeSnapshot>(path, {}, request);
    }, snapshot => {
        if (key === changeComparisonRequest?.key) changeComparisonRequest = undefined;
        changeSnapshot = snapshot;
        if (source === 'diff') diff.value = '';
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
    element<HTMLDetailsElement>('session-actions').open = false;
    element('account-details').textContent = `${account.displayName} · ${account.username}`;
    element<HTMLDialogElement>('account-dialog').showModal();
});
element('device-auth-open').addEventListener('click', openDeviceAuthorization);
element('device-refresh').addEventListener('click', loadDeviceCredentials);
form('device-code-form', () => {
    if (controllers.has('device-decision')) return;
    const code = input('device-code').value.trim();
    resetDeviceReview();
    void run('device-inspect', signal => api<{ clientName: string }>(devicePath + '/inspect', {}, jsonRequest({ code }, 'POST', signal)),
        result => {
            reviewedDevice = code;
            element('device-client').textContent = result.clientName + ' · ' + code.toUpperCase();
            element('device-review').hidden = false;
            report('device-inspect-status');
        });
});
input('device-code').addEventListener('input', () => {
    controllers.get('device-inspect')?.abort();
    resetDeviceReview();
});
element('device-approve').addEventListener('click', () => decideDevice(true));
element('device-deny').addEventListener('click', () => decideDevice(false));
element('device-auth').addEventListener('close', () => {
    for (const key of ['device-inspect', 'device-decision', 'device-credentials', 'device-revoke']) controllers.get(key)?.abort();
    resetDeviceReview();
    element<HTMLFormElement>('device-code-form').reset();
    element('device-credentials').replaceChildren();
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
form('operations-lookup', lookupOperations);
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
input('provider-concurrency').addEventListener('input', () => {
    const capacity = input('provider-concurrency').valueAsNumber;
    input('provider-reserved-ask').max = String(Number.isFinite(capacity) ? Math.max(0, capacity - 1) : 3);
});
input('provider-window-enabled').addEventListener('change', updateProviderWindowFields);
form('provider-form', () => {
    const draft = providerDraft();
    const window = draft.pool.backgroundWindow;
    if (window && (!window.weekdays.length || window.start === window.end)) {
        report('provider-write-status', window.weekdays.length ? 'providerWindowSameTime' : 'gitScheduleSelectDay', '', 'error');
        return;
    }
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
select('owner-project').addEventListener('change', () => chooseOwnerProject());
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
form('archive-identity-form', renameArchive);
element('archive-reuse').addEventListener('click', reuseArchive);
for (const group of document.querySelectorAll<HTMLElement>('[data-query-modes]')) {
    const field = select(group.dataset.queryModes!);
    const buttons = group.querySelectorAll<HTMLButtonElement>('[data-query-option]');
    for (const button of buttons) {
        button.addEventListener('click', () => {
            if (field.value === button.dataset.queryOption) return;
            field.value = button.dataset.queryOption!;
            for (const option of buttons) option.setAttribute('aria-pressed', String(option === button));
            field.dispatchEvent(new Event('input'));
        });
    }
}
form('search-form', () => search());
element('space-knowledge-search').addEventListener('click', () => {
    const doc = spaceDocument;
    if (doc) navigate('search', '', { mode: 'knowledge', spaceId: doc.spaceId, documentId: doc.id, versionId: doc.version.id });
});
element('wiki-knowledge-search').addEventListener('click', () => {
    const doc = wikiSummary?.document;
    if (doc?.knowledgeSnapshotId) navigate('search', doc.projectId, { mode: 'knowledge', snapshotId: doc.knowledgeSnapshotId,
        pageId: doc.id, revisionId: doc.revision?.id ?? doc.id });
});
form('graph-form', trace);
element('flow-analyze').addEventListener('click', runFlow);
input('file').addEventListener('input', syncLocateArchive);
form('locate-form', () => locate(input('file').value.trim(), input('line').valueAsNumber, selected,
    input('locate-archive-entry').value.trim()));
form('evidence-form', buildPack);
element('next').addEventListener('click', () => search(true));

for (const [panel, names] of [
    ['search', ['query', 'search-mode', 'search-scope', 'knowledge-sources']], ['graph', ['target', 'relation', 'depth']],
    ['evidence', ['evidence-query', 'budget']]
] as const) {
    for (const name of names) element(name).addEventListener('input', () => {
        controllers.get(panel)?.abort();
        element(`${panel}-results`).replaceChildren();
        report(`${panel}-status`);
        if (panel === 'graph') {
            graphView = undefined;
            flowView = undefined;
        }
        if (panel === 'search') resetSearchResults();
        if (name === 'search-mode') renderKnowledgeControls();
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
    try {
        await navigator.clipboard.writeText(element('source-content').textContent ?? '');
        report('copy-status', 'copied');
    } catch {
        report('copy-status', 'copyFailed');
    }
});

const repositoryTabs = settingsTabs('repository-settings', panel => {
    repositorySource = panel === 'git-connect' ? 'git' : panel === 'archive-upload' ? 'archive' : 'local';
    if (repositorySource === 'git') void loadGitConnections();
    else input('git-token').value = '';
});
const adminTabs = settingsTabs('admin-settings', loadAdminTab);
const gitTabs = settingsTabs('git-settings', panel => {
    if (panel === 'git-connection-settings') loadGitSettings();
    else {
        input('git-update-token').value = '';
        input('git-update-secret').value = '';
    }
});
const wikiSettingsTabs = settingsTabs('wiki-settings-tabs', panel => {
    if (panel === 'wiki-snapshot-management') loadWikiLifecycle();
});
settingsTabs('space-settings-content');
settingsTabs('device-settings');
settingsTabs('account-settings', panel => {
    if (panel !== 'account-password') element<HTMLFormElement>('password-form').reset();
});

localize();
selectLoginMethod();
void showWorkspace().catch(error => {
    showLogin(error instanceof RequestError && error.status === 401 ? '' : 'noNetwork');
});

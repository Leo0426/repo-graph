package com.repograph.benchmark;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.repograph.core.util.ProjectIdUtil;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchPage;
import com.repograph.core.vector.SearchResult;
import com.repograph.core.vector.VectorStore;
import com.repograph.vector.config.OllamaProperties;
import com.repograph.vector.config.QdrantProperties;
import com.repograph.vector.embedding.OllamaEmbeddingService;
import com.repograph.vector.store.QdrantVectorStore;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * 代码检索效果 benchmark，使用 repograph-app 模块自身的索引作为语料库（self-index）。
 *
 * <h2>前置条件</h2>
 * <ol>
 *   <li>Ollama 已启动（默认 {@code http://192.168.4.113:11434}），
 *       加载了 {@code manutic/nomic-embed-code} 模型</li>
 *   <li>Qdrant 已启动（默认 {@code localhost:16334}）</li>
 *   <li>repograph-app 目录已通过 REST API 建立索引</li>
 * </ol>
 * <p>任何条件未满足时所有测试自动跳过，不计为失败。
 *
 * <h2>运行方式</h2>
 * <pre>{@code
 * # 默认配置（corpus = repograph-app 自身，需先建索引）
 * ./gradlew :repograph-app:test --tests "*.benchmark.*"
 *
 * # 覆盖服务地址和项目路径
 * ./gradlew :repograph-app:test --tests "*.benchmark.*" \
 *   -Dbenchmark.projectRoot=/path/to/my-project \
 *   -Dbenchmark.qdrant.host=localhost \
 *   -Dbenchmark.qdrant.port=16334 \
 *   -Dbenchmark.ollama.url=http://localhost:11434
 * }</pre>
 *
 * <h2>评估指标</h2>
 * <ul>
 *   <li><b>Hit@K</b>：top-K 内出现相关结果的查询比例（K = 1/3/5/10）</li>
 *   <li><b>MRR@10</b>：平均倒数排名（Mean Reciprocal Rank）</li>
 *   <li><b>HitScore</b>：命中结果的相似度分数（rank=1 时与 top-1 score 相同；rank>1 时反映实际召回置信度）</li>
 * </ul>
 *
 * <h2>通过阈值（CI 回归守卫）</h2>
 * <ul>
 *   <li>语义检索：{@code Hit@10 ≥ 65%}</li>
 *   <li>代码相似检索：{@code Hit@10 ≥ 75%}</li>
 * </ul>
 *
 * @author leolu
 * @since 0.1.0
 */
@Tag("benchmark")
class CodeRetrievalBenchmark {

    // ── 评估深度 ───────────────────────────────────────────────────
    private static final int K = 10;

    /** 语义检索最低 Hit@10 通过率，低于此值测试失败（回归守卫）。 */
    private static final double SEMANTIC_HIT10_MIN = 0.65;

    /** 代码相似检索最低 Hit@10 通过率。 */
    private static final double CODE_HIT10_MIN = 0.75;

    // ── 运行时状态（BeforeAll 填充） ──────────────────────────────
    private static VectorStore vectorStore;
    private static String projectId;
    private static String projectLabel;

    // 保存两个 suite 的结果，供 AfterAll 写入 JSON 报告
    private static List<BenchmarkResult> lastSemanticResults;
    private static List<BenchmarkResult> lastCodeResults;

    // ══════════════════════════════════════════════════════════════
    // 语义检索数据集（自然语言 → 代码）
    //
    // 策略说明：
    //   · expectedPatterns 是目标 qualifiedName 的子串（任一匹配即 hit）
    //   · 每条用例至少包含一个类名作为首选，再用方法名作为备选
    //   · 私有方法（如 extractCallEdges）作为备选，类名作为保底
    //   · 避免单字母或过于泛化的字符串（如 "scan"）作为独立 pattern
    // ══════════════════════════════════════════════════════════════
    private static final List<BenchmarkCase> SEMANTIC_CASES = List.of(

        // ── 解析层 ────────────────────────────────────────────────
        new BenchmarkCase("S01", "Java AST parser",
                "parse Java source file extract class method field declarations using AST",
                Type.SEMANTIC, List.of("JavaCodeParser")),

        new BenchmarkCase("S02", "Java bytecode parser SootUp",
                "analyze Java bytecode class file with SootUp Jimple intermediate representation",
                Type.SEMANTIC, List.of("JavaBytecodeParser")),

        new BenchmarkCase("S03", "parser dispatcher",
                "route source file to correct parser implementation based on file extension",
                Type.SEMANTIC, List.of("ParserDispatcher", "dispatch")),

        new BenchmarkCase("S04", "C language tree-sitter parser",
                "parse C source file extract top-level function definitions and struct declarations",
                Type.SEMANTIC, List.of("CCodeParser")),

        new BenchmarkCase("S05", "Python tree-sitter parser",
                "parse Python source code to extract class and function definitions",
                Type.SEMANTIC, List.of("PythonCodeParser")),

        // extractCallEdges 是 JavaBytecodeParser 的私有方法，可能未被单独索引；
        // 类名 "JavaBytecodeParser" 作为保底，确保类级命中仍算 hit。
        new BenchmarkCase("S06", "extract bytecode call graph edges",
                "extract method call graph edges from bytecode invoke instructions in Jimple",
                Type.SEMANTIC, List.of("extractCallEdges", "JavaBytecodeParser")),

        new BenchmarkCase("S07", "heuristic fallback parser",
                "parse source file with regex heuristics when no precise parser is available",
                Type.SEMANTIC, List.of("HeuristicCodeParser")),

        // ── 向量与 Embedding 层 ───────────────────────────────────
        new BenchmarkCase("S08", "Ollama embed service",
                "call Ollama HTTP API to convert text strings into float vector embeddings",
                Type.SEMANTIC, List.of("OllamaEmbeddingService")),

        new BenchmarkCase("S09", "batch embed and upsert pipeline",
                "build embeddings for code units in parallel batches then write to vector storage",
                Type.SEMANTIC, List.of("EmbeddingUpsertRunner", "embedAndUpsert")),

        new BenchmarkCase("S10", "Qdrant semantic search",
                "search code units in Qdrant using natural language query via cosine similarity",
                Type.SEMANTIC, List.of("QdrantVectorStore", "semanticSearch")),

        new BenchmarkCase("S11", "Qdrant upsert code units",
                "batch insert or update code unit vectors into Qdrant collection",
                Type.SEMANTIC, List.of("QdrantVectorStore", "upsert")),

        // ── 图与存储层 ────────────────────────────────────────────
        new BenchmarkCase("S12", "Neo4j callers query",
                "traverse Neo4j code knowledge graph to find all callers of a method",
                Type.SEMANTIC, List.of("CodeGraphQueryService", "findCallers")),

        new BenchmarkCase("S13", "Neo4j impact analysis",
                "find all code units transitively affected by a change to a given symbol",
                Type.SEMANTIC, List.of("CodeGraphQueryService", "impactAnalysis")),

        // ── 管道与工具 ────────────────────────────────────────────
        new BenchmarkCase("S14", "full index pipeline orchestration",
                "orchestrate the complete indexing pipeline: scan files, parse, build graph, embed and upsert",
                Type.SEMANTIC, List.of("DefaultIndexPipeline", "IndexPipeline")),

        new BenchmarkCase("S15", "incremental index cache",
                "skip files unchanged since last index run using MD5 fingerprint SQLite cache",
                Type.SEMANTIC, List.of("IncrementalIndexCache")),

        new BenchmarkCase("S16", "source file scanner",
                "walk project directory recursively to collect source files filtered by extension",
                Type.SEMANTIC, List.of("SourceFileScanner")),

        new BenchmarkCase("S17", "code unit ID hash",
                "compute deterministic SHA256 hash as unique identifier for a code unit",
                Type.SEMANTIC, List.of("CodeUnitIdUtil", "computeId")),

        new BenchmarkCase("S18", "project ID generator",
                "generate a stable unique project identifier from the absolute directory path",
                Type.SEMANTIC, List.of("ProjectIdUtil", "generateProjectId")),

        new BenchmarkCase("S19", "Spring annotation detector",
                "detect Spring MVC RestController Service Repository framework annotations in Java",
                Type.SEMANTIC, List.of("AnnotationFrameworkDetector")),

        // ── REST API 层 ───────────────────────────────────────────
        new BenchmarkCase("S20", "REST semantic search endpoint",
                "HTTP REST endpoint to handle natural language code search request from client",
                Type.SEMANTIC, List.of("SearchController")),

        new BenchmarkCase("S21", "REST index trigger endpoint",
                "HTTP REST endpoint to trigger project indexing and return progress or result",
                Type.SEMANTIC, List.of("IndexController")),

        // ── 符号解析 ─────────────────────────────────────────────
        new BenchmarkCase("S22", "symbol lookup by qualified name",
                "find a code unit by its fully qualified name for precise symbol resolution",
                Type.SEMANTIC, List.of("symbolLookup", "SymbolController")),

        new BenchmarkCase("S23", "locate code by file and line",
                "locate the smallest code symbol that contains a given file path and line number",
                Type.SEMANTIC, List.of("locateByPosition", "SymbolController"))
    );

    // ══════════════════════════════════════════════════════════════
    // 代码相似检索数据集（代码片段 → 相似代码）
    //
    // 策略说明：
    //   · query 使用真实签名（直接从源码复制），最大化与 code 向量的相似度
    //   · 接口签名（无访问修饰符）和实现签名（含 public/throws）均可命中
    //   · expectedPatterns 包含接口名和主要实现类名
    // ══════════════════════════════════════════════════════════════
    private static final List<BenchmarkCase> CODE_CASES = List.of(

        new BenchmarkCase("C01", "embed method signature",
                "public List<float[]> embed(List<String> texts)",
                Type.CODE, List.of("OllamaEmbeddingService")),

        // CodeParser 接口签名（无 throws）和 JavaCodeParser 实现签名（含 throws）均应命中
        new BenchmarkCase("C02", "parse method signature",
                "ParseResult parse(Path file, ParseOptions options) throws ParseException",
                Type.CODE, List.of("JavaCodeParser", "JavaBytecodeParser", "CodeParser")),

        new BenchmarkCase("C03", "computeId signature",
                "public static String computeId(String projectId, String filePath,"
                        + " CodeUnitKind kind, String qualifiedName)",
                Type.CODE, List.of("CodeUnitIdUtil")),

        new BenchmarkCase("C04", "semanticSearch signature",
                "SearchPage semanticSearch(String nlQuery, SearchOptions opts)",
                Type.CODE, List.of("QdrantVectorStore", "VectorStore")),

        new BenchmarkCase("C05", "scan source files signature",
                "List<Path> scan(Path projectRoot, IndexOptions options)",
                Type.CODE, List.of("SourceFileScanner")),

        new BenchmarkCase("C06", "upsert embedded units signature",
                "void upsert(List<EmbeddedUnit> units, String projectId)",
                Type.CODE, List.of("QdrantVectorStore", "VectorStore")),

        new BenchmarkCase("C07", "findCallers graph query signature",
                "List<CodeUnit> findCallers(String qualifiedName, int depth)",
                Type.CODE, List.of("CodeGraphQueryService", "GraphQueryService")),

        new BenchmarkCase("C08", "index pipeline signature",
                "public IndexResult index(Path projectRoot, IndexOptions options)",
                Type.CODE, List.of("DefaultIndexPipeline", "IndexPipeline"))
    );

    // ══════════════════════════════════════════════════════════════
    // 初始化（探活 + 检查索引）
    // ══════════════════════════════════════════════════════════════

    @BeforeAll
    static void setup() {
        String qdrantHost    = prop("benchmark.qdrant.host",        "localhost");
        int    qdrantPort    = intProp("benchmark.qdrant.port",     16334);
        String collection    = prop("benchmark.qdrant.collection",  "code_units");
        int    vectorSize    = intProp("benchmark.qdrant.vectorSize", 3584);
        String ollamaUrl     = prop("benchmark.ollama.url",         "http://192.168.4.113:11434");
        String ollamaModel   = prop("benchmark.ollama.model",       "manutic/nomic-embed-code");
        int    ollamaTimeout = intProp("benchmark.ollama.timeout",  300);

        Path defaultRoot = findRepoRoot().resolve("repograph-app");
        Path projectRoot = Paths.get(prop("benchmark.projectRoot", defaultRoot.toString()));
        projectId    = ProjectIdUtil.generateProjectId(projectRoot);
        projectLabel = projectRoot.getFileName() + " [" + projectId + "]";

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(ollamaTimeout * 1_000);
        OllamaEmbeddingService embeddingService = new OllamaEmbeddingService(
                new OllamaProperties(ollamaUrl, ollamaModel, ollamaTimeout),
                new RestTemplate(factory));

        vectorStore = new QdrantVectorStore(
                new QdrantProperties(qdrantHost, qdrantPort, collection, vectorSize),
                embeddingService);

        System.out.printf("%n[benchmark] projectRoot=%s  projectId=%s%n", projectRoot, projectId);
        SearchOptions probe = new SearchOptions(1, 0, null, null, projectId, false, false);
        SearchPage page;
        try {
            page = vectorStore.semanticSearch("java parse class method", probe);
        } catch (Exception e) {
            assumeTrue(false,
                    "[benchmark] Qdrant (" + qdrantHost + ":" + qdrantPort
                    + ") or Ollama (" + ollamaUrl + ") not available: " + rootCause(e));
            return;
        }
        assumeTrue(!page.results().isEmpty(),
                "[benchmark] Project not indexed (projectId=" + projectId + ").\n"
                + "  Index it first via POST /api/v1/index/project?projectRoot=" + projectRoot);

        System.out.println("[benchmark] probe OK — corpus size ≥ 1, starting benchmark…");
    }

    // ══════════════════════════════════════════════════════════════
    // 测试用例
    // ══════════════════════════════════════════════════════════════

    @Test
    void semanticSearchBenchmark() {
        printSuiteHeader("SEMANTIC SEARCH", SEMANTIC_CASES.size());
        List<BenchmarkResult> results = runSuite(SEMANTIC_CASES);
        BenchmarkReporter.print("SEMANTIC SEARCH", results, K);
        lastSemanticResults = results;

        double hit10 = hitRate(results, K);
        assertTrue(hit10 >= SEMANTIC_HIT10_MIN,
                String.format("Semantic Hit@10 %.1f%% < threshold %.0f%% — retrieval quality regression?",
                        hit10 * 100, SEMANTIC_HIT10_MIN * 100));
    }

    @Test
    void codeSearchBenchmark() {
        printSuiteHeader("CODE SEARCH", CODE_CASES.size());
        List<BenchmarkResult> results = runSuite(CODE_CASES);
        BenchmarkReporter.print("CODE SEARCH", results, K);
        lastCodeResults = results;

        double hit10 = hitRate(results, K);
        assertTrue(hit10 >= CODE_HIT10_MIN,
                String.format("Code Hit@10 %.1f%% < threshold %.0f%% — retrieval quality regression?",
                        hit10 * 100, CODE_HIT10_MIN * 100));
    }

    @AfterAll
    static void afterAll() {
        if (lastSemanticResults != null || lastCodeResults != null) {
            List<BenchmarkResult> sem  = lastSemanticResults != null ? lastSemanticResults : List.of();
            List<BenchmarkResult> code = lastCodeResults    != null ? lastCodeResults    : List.of();
            BenchmarkJsonWriter.write(projectLabel, K, sem, SEMANTIC_HIT10_MIN, code, CODE_HIT10_MIN);
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 执行与评估
    // ══════════════════════════════════════════════════════════════

    private List<BenchmarkResult> runSuite(List<BenchmarkCase> cases) {
        SearchOptions opts = new SearchOptions(K, 0, null, null, projectId, false, false);
        return cases.stream()
                .map(c -> evaluate(c, opts))
                .collect(Collectors.toList());
    }

    /**
     * 执行单条用例，返回含排名的结果。
     *
     * <p>相关性判定：qualifiedName 中含有 expectedPatterns 中的任意一个子串（忽略大小写）即 hit。
     * {@code rank} = 命中结果在返回列表中的位置（1-based）；0 表示 top-K 内无命中。
     * {@code hitScore} = 命中结果的相似度分数；未命中时为 0。
     */
    private static BenchmarkResult evaluate(BenchmarkCase c, SearchOptions opts) {
        SearchPage page = c.type() == Type.SEMANTIC
                ? vectorStore.semanticSearch(c.query(), opts)
                : vectorStore.codeSearch(c.query(), opts);

        List<SearchResult> results = page.results();
        List<String> qns = results.stream()
                .map(r -> r.unit().qualifiedName())
                .collect(Collectors.toList());

        int rank = 0;
        float hitScore = 0f;
        for (int i = 0; i < results.size(); i++) {
            String qnLower = qns.get(i).toLowerCase();
            boolean hit = c.expectedPatterns().stream()
                    .anyMatch(p -> qnLower.contains(p.toLowerCase()));
            if (hit) {
                rank = i + 1;
                hitScore = results.get(i).score();
                break;
            }
        }

        float topScore = results.isEmpty() ? 0f : results.get(0).score();
        return new BenchmarkResult(c, rank, topScore, hitScore, qns);
    }

    // ══════════════════════════════════════════════════════════════
    // 工具方法
    // ══════════════════════════════════════════════════════════════

    private static double hitRate(List<BenchmarkResult> results, int k) {
        return (double) results.stream().filter(r -> r.hitAt(k)).count() / results.size();
    }

    private static void printSuiteHeader(String suite, int count) {
        System.out.printf("%n╔══════════════════════════════════════════════════════════╗%n");
        System.out.printf("║  RepoGraph Code Retrieval Benchmark · %-26s║%n", suite);
        System.out.printf("║  Corpus: %-49s║%n", projectLabel);
        System.out.printf("║  Queries: %-2d  K=%-2d%s║%n", count, K, " ".repeat(40));
        System.out.printf("╚══════════════════════════════════════════════════════════╝%n");
    }

    private static String prop(String key, String def) {
        return System.getProperty(key, def);
    }

    private static int intProp(String key, int def) {
        String v = System.getProperty(key);
        return v != null ? Integer.parseInt(v) : def;
    }

    private static String rootCause(Throwable t) {
        while (t.getCause() != null) t = t.getCause();
        return t.getClass().getSimpleName() + ": " + t.getMessage();
    }

    /** 向上查找含 settings.gradle.kts 的目录（仓库根）。 */
    private static Path findRepoRoot() {
        Path dir = Paths.get("").toAbsolutePath();
        while (dir != null) {
            if (dir.resolve("settings.gradle.kts").toFile().exists()
                    || dir.resolve("settings.gradle").toFile().exists()) {
                return dir;
            }
            dir = dir.getParent();
        }
        return Paths.get("").toAbsolutePath();
    }

    private enum Type { SEMANTIC, CODE }

    private record BenchmarkCase(
            String id,
            String description,
            String query,
            Type type,
            List<String> expectedPatterns
    ) {
    }

    private record BenchmarkResult(
            BenchmarkCase benchCase,
            int rank,
            float topScore,
            float hitScore,
            List<String> retrieved
    ) {
        private boolean hitAt(int k) {
            return rank >= 1 && rank <= k;
        }

        private double reciprocalRank() {
            return rank >= 1 ? 1.0 / rank : 0.0;
        }
    }

    private static final class BenchmarkReporter {

        private static final int[] KS = {1, 3, 5, 10};
        private static final int DESC_WIDTH = 50;

        private BenchmarkReporter() {
        }

        private static void print(String title, List<BenchmarkResult> results, int k) {
            System.out.println();
            System.out.println("── " + title + " (" + results.size() + " queries, K=" + k + ") "
                    + "─".repeat(40));
            printHeader();
            results.forEach(result -> printRow(result, k));
            System.out.println("  " + "─".repeat(82));
            printAggregate(results, k);
            printMisses(results, k);
        }

        private static void printHeader() {
            System.out.printf("  %-4s  %-" + DESC_WIDTH + "s  %3s %3s %3s %3s  %4s  %9s%n",
                    "ID", "Query / Description", "@1", "@3", "@5", "10", "Rank", "HitScore");
            System.out.println("  " + "─".repeat(82));
        }

        private static void printRow(BenchmarkResult result, int k) {
            String description = result.benchCase().description();
            if (description.length() > DESC_WIDTH) {
                description = description.substring(0, DESC_WIDTH - 1) + "…";
            }
            System.out.printf("  %-4s  %-" + DESC_WIDTH + "s  %3s %3s %3s %3s  %4s  %9.3f%n",
                    result.benchCase().id(), description,
                    mark(result, 1), mark(result, 3), mark(result, 5), mark(result, 10),
                    result.rank() > 0 ? String.valueOf(result.rank()) : "—", result.hitScore());
        }

        private static String mark(BenchmarkResult result, int k) {
            return result.hitAt(k) ? "✓" : "✗";
        }

        private static void printAggregate(List<BenchmarkResult> results, int k) {
            System.out.print(" ");
            for (int currentK : KS) {
                long hits = results.stream().filter(result -> result.hitAt(currentK)).count();
                System.out.printf("  Hit@%-2d %5.1f%%", currentK, 100.0 * hits / results.size());
            }
            System.out.println();

            double mrr = results.stream().mapToDouble(BenchmarkResult::reciprocalRank).average().orElse(0);
            double avgTop1 = results.stream().mapToDouble(BenchmarkResult::topScore).average().orElse(0);
            System.out.printf("  MRR@%-2d %.3f    Avg top-1 score %.3f%n%n", k, mrr, avgTop1);
        }

        private static void printMisses(List<BenchmarkResult> results, int k) {
            List<BenchmarkResult> misses = results.stream().filter(result -> !result.hitAt(k)).toList();
            if (misses.isEmpty()) {
                return;
            }
            System.out.println("  Misses (rank > " + k + " or not found):");
            for (BenchmarkResult miss : misses) {
                System.out.printf("    %s  \"%s\"%n", miss.benchCase().id(), miss.benchCase().query());
                System.out.printf("       expected : %s%n", miss.benchCase().expectedPatterns());
                if (!miss.retrieved().isEmpty()) {
                    System.out.printf("       top-1    : %s  (score=%.3f)%n",
                            miss.retrieved().get(0), miss.topScore());
                } else {
                    System.out.println("       top-1    : (no results returned)");
                }
            }
            System.out.println();
        }
    }

    private static final class BenchmarkJsonWriter {

        private static final ObjectMapper MAPPER = new ObjectMapper()
                .enable(SerializationFeature.INDENT_OUTPUT);
        private static final DateTimeFormatter FORMATTER =
                DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        private static final Path OUTPUT_FILE =
                Path.of(System.getProperty("user.home"), ".repograph", "benchmark-latest.json");

        private BenchmarkJsonWriter() {
        }

        private static void write(String projectLabel, int k,
                                  List<BenchmarkResult> semanticResults, double semanticThreshold,
                                  List<BenchmarkResult> codeResults, double codeThreshold) {
            try {
                Files.createDirectories(OUTPUT_FILE.getParent());
                ObjectNode root = MAPPER.createObjectNode();
                root.put("generatedAt", LocalDateTime.now().format(FORMATTER));
                root.put("projectLabel", projectLabel);
                root.set("semantic", section("SEMANTIC SEARCH", k, semanticResults, semanticThreshold));
                root.set("code", section("CODE SEARCH", k, codeResults, codeThreshold));
                MAPPER.writeValue(OUTPUT_FILE.toFile(), root);
                System.out.println("[benchmark] results written to " + OUTPUT_FILE);
            } catch (IOException e) {
                System.err.println("[benchmark] failed to write results JSON: " + e.getMessage());
            }
        }

        private static ObjectNode section(String title, int k,
                                          List<BenchmarkResult> results, double threshold) {
            ObjectNode section = MAPPER.createObjectNode();
            section.put("title", title);
            section.put("total", results.size());
            section.put("threshold", threshold);
            section.put("hit1Rate", hitRate(results, 1));
            section.put("hit3Rate", hitRate(results, 3));
            section.put("hit5Rate", hitRate(results, 5));
            section.put("hit10Rate", hitRate(results, k));
            section.put("mrr10", mrr(results));
            section.put("passed", hitRate(results, k) >= threshold);

            ArrayNode cases = section.putArray("cases");
            for (BenchmarkResult result : results) {
                ObjectNode benchmarkCase = cases.addObject();
                benchmarkCase.put("id", result.benchCase().id());
                benchmarkCase.put("description", result.benchCase().description());
                benchmarkCase.put("rank", result.rank());
                benchmarkCase.put("topScore", result.topScore());
                benchmarkCase.put("hitScore", result.hitScore());
                benchmarkCase.put("hit1", result.hitAt(1));
                benchmarkCase.put("hit3", result.hitAt(3));
                benchmarkCase.put("hit5", result.hitAt(5));
                benchmarkCase.put("hit10", result.hitAt(k));
                benchmarkCase.put("topResult", result.retrieved().isEmpty() ? "" : result.retrieved().get(0));
            }
            return section;
        }

        private static double hitRate(List<BenchmarkResult> results, int k) {
            if (results.isEmpty()) {
                return 0;
            }
            return (double) results.stream().filter(result -> result.hitAt(k)).count() / results.size();
        }

        private static double mrr(List<BenchmarkResult> results) {
            return results.stream().mapToDouble(BenchmarkResult::reciprocalRank).average().orElse(0);
        }
    }
}

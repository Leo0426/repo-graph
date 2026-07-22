package com.repograph.vuln;

import com.repograph.core.graph.GraphDiagnosticsService;
import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 验证 {@link CodeVulnScanner} 内置规则的命中与误报控制。
 *
 * <p>每个测试构造最小化的 rawSource 字符串，通过 Stub GraphQueryService 注入，
 * 直接断言 {@link VulnStore} 收到的 finding 列表，无需 Neo4j / SQLite。
 *
 * @author leolu
 * @since 0.5.0
 */
class CodeVulnScannerRulesTest {

    private CapturingVulnStore capturingStore;
    private CodeVulnScanner scanner;

    @BeforeEach
    void setUp() {
        capturingStore = new CapturingVulnStore();
    }

    // ── SQL_INJECTION ──────────────────────────────────────────────────────────

    @Test
    void sqlInjection_stringConcat_detected() {
        scanner = scannerWith("""
                public List<User> findByName(String name) {
                    Statement stmt = conn.createStatement();
                    return stmt.executeQuery("SELECT * FROM user WHERE name = '" + name + "'");
                }
                """);
        assertHasRule("SQL_INJECTION");
    }

    @Test
    void sqlInjection_preparedStatement_notFlagged() {
        scanner = scannerWith("""
                public User findById(long id) {
                    PreparedStatement ps = conn.prepareStatement("SELECT * FROM user WHERE id = ?");
                    ps.setLong(1, id);
                    return ps.executeQuery();
                }
                """);
        assertNoRule("SQL_INJECTION");
    }

    // ── COMMAND_INJECTION ─────────────────────────────────────────────────────

    @Test
    void commandInjection_runtimeExec_detected() {
        scanner = scannerWith("""
                public void run(String cmd) throws Exception {
                    Runtime.getRuntime().exec(cmd);
                }
                """);
        assertHasRule("COMMAND_INJECTION");
    }

    @Test
    void commandInjection_processBuilder_detected() {
        scanner = scannerWith("""
                public Process start(String[] args) throws Exception {
                    return new ProcessBuilder(args).start();
                }
                """);
        assertHasRule("COMMAND_INJECTION");
    }

    // ── INSECURE_DESERIALIZATION ───────────────────────────────────────────────

    @Test
    void insecureDeserialization_readObject_detected() {
        scanner = scannerWith("""
                public Object deserialize(byte[] data) throws Exception {
                    ObjectInputStream ois = new ObjectInputStream(new ByteArrayInputStream(data));
                    return ois.readObject();
                }
                """);
        assertHasRule("INSECURE_DESERIALIZATION");
    }

    // ── WEAK_CRYPTO ───────────────────────────────────────────────────────────

    @Test
    void weakCrypto_md5_detected() {
        scanner = scannerWith("""
                public byte[] hash(String input) throws Exception {
                    return MessageDigest.getInstance("MD5").digest(input.getBytes());
                }
                """);
        assertHasRule("WEAK_CRYPTO");
    }

    @Test
    void weakCrypto_sha256_notFlagged() {
        scanner = scannerWith("""
                public byte[] hash(String input) throws Exception {
                    return MessageDigest.getInstance("SHA-256").digest(input.getBytes());
                }
                """);
        assertNoRule("WEAK_CRYPTO");
    }

    // ── HARDCODED_SECRET ──────────────────────────────────────────────────────

    @Test
    void hardcodedSecret_password_detected() {
        scanner = scannerWith("""
                private static final String password = "super-secret-123";
                """);
        assertHasRule("HARDCODED_SECRET");
    }

    // ── PATH_TRAVERSAL ────────────────────────────────────────────────────────

    @Test
    void pathTraversal_getParameterInFile_detected() {
        scanner = scannerWith("""
                public byte[] download(HttpServletRequest req) throws IOException {
                    String filename = req.getParameter("file");
                    return Files.readAllBytes(new File("/data/" + filename).toPath());
                }
                """);
        assertHasRule("PATH_TRAVERSAL");
    }

    @Test
    void pathTraversal_dotdot_detected() {
        scanner = scannerWith("""
                public String read(String path) throws IOException {
                    return Files.readString(Paths.get("../conf/" + path));
                }
                """);
        assertHasRule("PATH_TRAVERSAL");
    }

    @Test
    void pathTraversal_hardcodedPath_notFlagged() {
        scanner = scannerWith("""
                public String readConfig() throws IOException {
                    return Files.readString(Paths.get("/etc/app/config.yml"));
                }
                """);
        assertNoRule("PATH_TRAVERSAL");
    }

    // ── XXE_INJECTION ─────────────────────────────────────────────────────────

    @Test
    void xxe_documentBuilderNoSecureFeature_detected() {
        scanner = scannerWith("""
                public Document parse(InputStream xml) throws Exception {
                    DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
                    return dbf.newDocumentBuilder().parse(xml);
                }
                """);
        assertHasRule("XXE_INJECTION");
    }

    @Test
    void xxe_documentBuilderWithSecureFeature_notFlagged() {
        scanner = scannerWith("""
                public Document parse(InputStream xml) throws Exception {
                    DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
                    dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
                    return dbf.newDocumentBuilder().parse(xml);
                }
                """);
        assertNoRule("XXE_INJECTION");
    }

    // ── INSECURE_RANDOM ───────────────────────────────────────────────────────

    @Test
    void insecureRandom_inTokenMethod_detected() {
        scanner = scannerWith("""
                public String generateToken(String userId) {
                    Random rng = new Random();
                    return Long.toHexString(rng.nextLong()) + userId;
                }
                """);
        assertHasRule("INSECURE_RANDOM");
    }

    @Test
    void insecureRandom_inNonSecurityMethod_notFlagged() {
        scanner = scannerWith("""
                public int roll() {
                    return new Random().nextInt(6) + 1;
                }
                """);
        assertNoRule("INSECURE_RANDOM");
    }

    // ── SENSITIVE_LOG ─────────────────────────────────────────────────────────

    @Test
    void sensitiveLog_passwordInLogInfo_detected() {
        scanner = scannerWith("""
                public void login(String user, String password) {
                    log.info("Login attempt: user={}, password={}", user, password);
                }
                """);
        assertHasRule("SENSITIVE_LOG");
    }

    @Test
    void sensitiveLog_noSensitiveField_notFlagged() {
        scanner = scannerWith("""
                public void login(String user, String password) {
                    log.info("Login attempt for user: {}", user);
                    doLogin(user, password);
                }
                """);
        assertNoRule("SENSITIVE_LOG");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private CodeVulnScanner scannerWith(String rawSource) {
        capturingStore = new CapturingVulnStore();
        return new CodeVulnScanner(stubGraph(rawSource), capturingStore);
    }

    private void assertHasRule(String ruleId) {
        scanner.scan("test-project");
        assertThat(capturingStore.findings)
                .as("Expected rule %s to fire", ruleId)
                .anyMatch(f -> ruleId.equals(f.ruleId()));
    }

    private void assertNoRule(String ruleId) {
        scanner.scan("test-project");
        assertThat(capturingStore.findings)
                .as("Expected rule %s NOT to fire", ruleId)
                .noneMatch(f -> ruleId.equals(f.ruleId()));
    }

    private static GraphDiagnosticsService stubGraph(String rawSource) {
        CodeUnit unit = new CodeUnit(
                "unit-id-001", CodeUnitKind.METHOD, "java",
                "com.example.Foo#test()", "test",
                "src/main/java/com/example/Foo.java", 1, 20,
                rawSource, "void test()", List.of(), "com.example.Foo", Map.of());
        return new StubGraphDiagnosticsService(unit);
    }

    // ── Stubs ─────────────────────────────────────────────────────────────────

    private static final class CapturingVulnStore extends VulnStore {
        final List<VulnFinding> findings = new ArrayList<>();

        CapturingVulnStore() {
            super(":memory:");
        }

        @Override
        public void upsertAll(List<VulnFinding> f) {
            findings.addAll(f);
        }
    }

    private record StubGraphDiagnosticsService(CodeUnit unit) implements GraphDiagnosticsService {
        @Override public List<CodeUnit> listScanTargets(String p) { return List.of(unit); }
        @Override public List<CodeUnit> listSearchTargets(String p, String l,
                com.repograph.core.model.CodeUnitKind k, boolean n, int limit) { return List.of(unit); }
        @Override public List<CodeUnit> findDeadCode(String p) { return List.of(); }
        @Override public List<CodeUnit> findTestGaps(String p) { return List.of(); }
        @Override public List<com.repograph.core.graph.ClassEdge> findClassCallEdges(String p) { return List.of(); }
    }
}

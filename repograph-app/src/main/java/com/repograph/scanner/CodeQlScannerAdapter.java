package com.repograph.scanner;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.scanner.ScannerAdapter;
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerCapability;
import com.repograph.core.scanner.ScannerRequest;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import com.repograph.finding.ExternalFindingImportException;
import com.repograph.finding.SarifFindingImporter;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * CodeQL CLI 适配器，创建受控数据库并将 SARIF 输出归一化。
 *
 * @author leolu
 */
@Component
public class CodeQlScannerAdapter implements ScannerAdapter {

    private static final String SCANNER = "CODEQL";
    private static final Map<String, CodeQlLanguage> LANGUAGES = languages();

    private final ScannerProperties properties;
    private final SarifFindingImporter importer;

    /**
     * 创建 CodeQL 扫描器适配器。
     *
     * @param properties 扫描器配置
     * @param importer   SARIF 导入器
     */
    public CodeQlScannerAdapter(
            ScannerProperties properties,
            SarifFindingImporter importer) {
        this.properties = properties;
        this.importer = importer;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public ScannerCapability capability() {
        return new ScannerCapability(
                SCANNER,
                List.copyOf(LANGUAGES.keySet()),
                properties.codeqlCommand(),
                "sarif-2.1.0",
                List.of("one build-mode-none language is required", "project builds are never executed"));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public ScannerAvailability probe() {
        Path probeDir = properties.workDir().toAbsolutePath().normalize().resolve("probe/codeql");
        CliProcessRunner.ProbeOutcome outcome = CliProcessRunner.probe(
                properties.codeqlCommand(), probeDir, Math.min(properties.defaultTimeoutSeconds(), 10));
        return new ScannerAvailability(
                capability(), outcome.available(), outcome.version(), outcome.error());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public ScannerRunResult scan(ScannerRequest request) {
        validate(request);
        Instant started = Instant.now();
        long startedNanos = System.nanoTime();
        List<CodeQlLanguage> languages = selectLanguages(request.languages());
        if (languages.isEmpty()) {
            return result(request, ScannerRunStatus.FAILED, "", -1, started, startedNanos,
                    List.of(), "no CodeQL-supported language in scanner request");
        }
        Path runDir = controlledRunDirectory(request.scanId());
        try {
            Files.createDirectories(runDir);
        } catch (IOException e) {
            return result(request, ScannerRunStatus.FAILED, "", -1, started, startedNanos,
                    List.of(), "failed to create controlled output directory: " + safeMessage(e));
        }

        CliProcessRunner.ProcessOutcome version = CliProcessRunner.run(
                List.of(properties.codeqlCommand(), "--version"),
                request.projectRoot(),
                runDir.resolve("version.stdout"),
                runDir.resolve("version.stderr"),
                Math.min(request.timeoutSeconds(), 10));
        if (!version.started() || version.timedOut() || version.exitCode() != 0) {
            String error = !version.started()
                    ? version.error()
                    : version.timedOut() ? "version probe timed out"
                    : "version probe exited with code " + version.exitCode();
            return result(request, ScannerRunStatus.UNAVAILABLE, "", version.exitCode(), started, startedNanos,
                    List.of(), error);
        }
        String versionText = CliProcessRunner.firstLine(runDir.resolve("version.stdout"));

        List<ExternalFinding> findings = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        int succeededLanguages = 0;
        boolean timedOut = false;
        for (CodeQlLanguage language : languages) {
            LanguageScanOutcome outcome = scanLanguage(request, runDir, language, findings.size());
            if (outcome.status() == ScannerRunStatus.SUCCEEDED) {
                succeededLanguages++;
                findings.addAll(outcome.findings());
            } else {
                timedOut |= outcome.status() == ScannerRunStatus.TIMED_OUT;
                failures.add(language.queryLanguage() + ": " + outcome.error());
            }
        }
        ScannerRunStatus status;
        if (succeededLanguages == languages.size()) {
            status = ScannerRunStatus.SUCCEEDED;
        } else if (succeededLanguages > 0) {
            status = ScannerRunStatus.PARTIAL;
        } else {
            status = timedOut ? ScannerRunStatus.TIMED_OUT : ScannerRunStatus.FAILED;
        }
        return result(
                request,
                status,
                versionText,
                status == ScannerRunStatus.SUCCEEDED ? 0 : -1,
                started,
                startedNanos,
                findings,
                String.join("; ", failures));
    }

    private LanguageScanOutcome scanLanguage(
            ScannerRequest request,
            Path runDir,
            CodeQlLanguage language,
            int importedFindings) {
        String suffix = language.queryLanguage();
        Path database = runDir.resolve("database-" + suffix);
        List<String> createCommand = new java.util.ArrayList<>(List.of(
                properties.codeqlCommand(),
                "database",
                "create",
                database.toString(),
                "--source-root=" + request.projectRoot().toAbsolutePath().normalize(),
                "--language=" + language.databaseLanguage(),
                "--overwrite"));
        createCommand.add("--build-mode=none");
        CliProcessRunner.ProcessOutcome create = CliProcessRunner.run(
                createCommand,
                request.projectRoot(),
                runDir.resolve("create-" + suffix + ".stdout"),
                runDir.resolve("create-" + suffix + ".stderr"),
                request.timeoutSeconds());
        LanguageScanOutcome failedCreate = failureOutcome(
                create, "database creation", request.timeoutSeconds());
        if (failedCreate != null) {
            return failedCreate;
        }

        Path output = runDir.resolve("results-" + suffix + ".sarif");
        CliProcessRunner.ProcessOutcome analyze = CliProcessRunner.run(
                List.of(
                        properties.codeqlCommand(),
                        "database",
                        "analyze",
                        database.toString(),
                        querySuite(language),
                        "--format=sarifv2.1.0",
                        "--output=" + output,
                        "--threads=0"),
                request.projectRoot(),
                runDir.resolve("analyze-" + suffix + ".stdout"),
                runDir.resolve("analyze-" + suffix + ".stderr"),
                request.timeoutSeconds());
        LanguageScanOutcome failedAnalyze = failureOutcome(
                analyze, "database analysis", request.timeoutSeconds());
        if (failedAnalyze != null) {
            return failedAnalyze;
        }
        try {
            if (!Files.isRegularFile(output)) {
                throw new ExternalFindingImportException("CodeQL did not create results.sarif");
            }
            if (Files.size(output) > properties.maxOutputBytes()) {
                return new LanguageScanOutcome(
                        ScannerRunStatus.FAILED, analyze.exitCode(), List.of(),
                        "scanner output exceeds configured limit");
            }
            int remaining = properties.maxFindings() - importedFindings;
            if (remaining < 1) {
                return new LanguageScanOutcome(ScannerRunStatus.SUCCEEDED, analyze.exitCode(), List.of(), "");
            }
            List<ExternalFinding> findings;
            try (var input = Files.newInputStream(output)) {
                findings = importer.importJson(input, remaining);
            }
            return new LanguageScanOutcome(ScannerRunStatus.SUCCEEDED, analyze.exitCode(), findings, "");
        } catch (IOException | ExternalFindingImportException e) {
            return new LanguageScanOutcome(
                    ScannerRunStatus.FAILED, analyze.exitCode(), List.of(),
                    "failed to import CodeQL output: " + safeMessage(e));
        }
    }

    private LanguageScanOutcome failureOutcome(
            CliProcessRunner.ProcessOutcome outcome,
            String phase,
            long timeoutSeconds) {
        if (!outcome.started()) {
            return new LanguageScanOutcome(
                    ScannerRunStatus.FAILED, -1, List.of(), phase + " failed to start: " + outcome.error());
        }
        if (outcome.timedOut()) {
            return new LanguageScanOutcome(
                    ScannerRunStatus.TIMED_OUT, -1, List.of(),
                    phase + " timed out after " + timeoutSeconds + " seconds");
        }
        if (outcome.exitCode() != 0) {
            return new LanguageScanOutcome(
                    ScannerRunStatus.FAILED, outcome.exitCode(), List.of(),
                    phase + " exited with code " + outcome.exitCode());
        }
        return null;
    }

    private ScannerRunResult result(
            ScannerRequest request,
            ScannerRunStatus status,
            String version,
            int exitCode,
            Instant started,
            long startedNanos,
            List<ExternalFinding> findings,
            String error) {
        return new ScannerRunResult(
                request.scanId(),
                request.projectId(),
                SCANNER,
                status,
                version,
                exitCode,
                TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos),
                started.toString(),
                Instant.now().toString(),
                findings,
                error);
    }

    private Path controlledRunDirectory(String scanId) {
        if (scanId == null || !scanId.matches("[A-Za-z0-9_-]+")) {
            throw new IllegalArgumentException("scanId must contain only letters, numbers, '_' or '-'");
        }
        Path root = properties.workDir().toAbsolutePath().normalize();
        Path runDir = root.resolve(scanId).resolve("codeql").normalize();
        if (!runDir.startsWith(root)) {
            throw new IllegalArgumentException("scan output path escapes controlled root");
        }
        return runDir;
    }

    private String querySuite(CodeQlLanguage language) {
        String configured = properties.codeqlQuerySuite();
        if (configured.startsWith("codeql/") || configured.endsWith(".qls")) {
            return configured;
        }
        return "codeql/" + language.queryLanguage() + "-queries:codeql-suites/"
                + language.queryLanguage() + "-" + configured + ".qls";
    }

    private static List<CodeQlLanguage> selectLanguages(List<String> requested) {
        Map<String, CodeQlLanguage> selected = new LinkedHashMap<>();
        for (String language : requested) {
            CodeQlLanguage match = LANGUAGES.get(language.toLowerCase(Locale.ROOT));
            if (match != null) {
                selected.putIfAbsent(match.queryLanguage(), match);
            }
        }
        return List.copyOf(selected.values());
    }

    private static Map<String, CodeQlLanguage> languages() {
        Map<String, CodeQlLanguage> languages = new LinkedHashMap<>();
        languages.put("java", new CodeQlLanguage("java-kotlin", "java"));
        languages.put("kotlin", new CodeQlLanguage("java-kotlin", "java"));
        languages.put("javascript", new CodeQlLanguage("javascript-typescript", "javascript"));
        languages.put("typescript", new CodeQlLanguage("javascript-typescript", "javascript"));
        languages.put("python", new CodeQlLanguage("python", "python"));
        languages.put("csharp", new CodeQlLanguage("csharp", "csharp"));
        languages.put("ruby", new CodeQlLanguage("ruby", "ruby"));
        return Collections.unmodifiableMap(languages);
    }

    private static void validate(ScannerRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("scanner request is required");
        }
        if (!Files.isDirectory(request.projectRoot())) {
            throw new IllegalArgumentException("projectRoot must be an existing directory");
        }
        if (request.timeoutSeconds() < 1) {
            throw new IllegalArgumentException("timeoutSeconds must be greater than zero");
        }
    }

    private static String safeMessage(Exception exception) {
        return exception.getMessage() == null || exception.getMessage().isBlank()
                ? exception.getClass().getSimpleName()
                : exception.getMessage();
    }

    private record CodeQlLanguage(String databaseLanguage, String queryLanguage) {}

    private record LanguageScanOutcome(
            ScannerRunStatus status,
            int exitCode,
            List<ExternalFinding> findings,
            String error
    ) {}

}

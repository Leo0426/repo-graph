package com.repograph.scanner;

import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.scanner.ScannerAdapter;
import com.repograph.core.scanner.ScannerAvailability;
import com.repograph.core.scanner.ScannerCapability;
import com.repograph.core.scanner.ScannerRequest;
import com.repograph.core.scanner.ScannerRunResult;
import com.repograph.core.scanner.ScannerRunStatus;
import com.repograph.finding.ExternalFindingImportException;
import com.repograph.finding.SemgrepFindingImporter;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Semgrep CLI 适配器，通过参数数组执行并复用统一 JSON 导入器。
 *
 * @author leolu
 */
@Component
public class SemgrepScannerAdapter implements ScannerAdapter {

    private static final String SCANNER = "SEMGREP";
    private static final List<String> LANGUAGES = List.of(
            "java", "kotlin", "c", "cpp", "python", "javascript", "typescript",
            "go", "php", "ruby", "solidity");

    private final ScannerProperties properties;
    private final SemgrepFindingImporter importer;

    /**
     * 创建 Semgrep 扫描器适配器。
     *
     * @param properties 扫描器配置
     * @param importer   Semgrep JSON 导入器
     */
    public SemgrepScannerAdapter(
            ScannerProperties properties,
            SemgrepFindingImporter importer) {
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
                LANGUAGES,
                properties.semgrepCommand(),
                "semgrep-json",
                List.of("project source must be readable"));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public ScannerAvailability probe() {
        Path probeDir = properties.workDir().toAbsolutePath().normalize().resolve("probe/semgrep");
        CliProcessRunner.ProbeOutcome outcome = CliProcessRunner.probe(
                properties.semgrepCommand(), probeDir, Math.min(properties.defaultTimeoutSeconds(), 10));
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
        Path runDir = controlledRunDirectory(request.scanId());
        try {
            Files.createDirectories(runDir);
        } catch (IOException e) {
            return result(request, ScannerRunStatus.FAILED, "", -1, started, startedNanos,
                    List.of(), "failed to create controlled output directory: " + safeMessage(e));
        }

        CliProcessRunner.ProcessOutcome version = CliProcessRunner.run(
                List.of(properties.semgrepCommand(), "--version"),
                request.projectRoot(),
                runDir.resolve("version.stdout"),
                runDir.resolve("version.stderr"),
                Math.min(request.timeoutSeconds(), 10));
        if (!version.started()) {
            return result(request, ScannerRunStatus.UNAVAILABLE, "", -1, started, startedNanos,
                    List.of(), version.error());
        }
        if (version.timedOut() || version.exitCode() != 0) {
            String error = version.timedOut()
                    ? "version probe timed out"
                    : "version probe exited with code " + version.exitCode();
            return result(request, ScannerRunStatus.UNAVAILABLE, "", version.exitCode(), started, startedNanos,
                    List.of(), error);
        }
        String versionText = CliProcessRunner.firstLine(runDir.resolve("version.stdout"));
        Path output = runDir.resolve("results.json");
        CliProcessRunner.ProcessOutcome scan = CliProcessRunner.run(
                List.of(
                        properties.semgrepCommand(),
                        "scan",
                        "--config", properties.semgrepConfig(),
                        "--json",
                        "--output", output.toString(),
                        "."),
                request.projectRoot(),
                runDir.resolve("scan.stdout"),
                runDir.resolve("scan.stderr"),
                request.timeoutSeconds());
        if (!scan.started()) {
            return result(request, ScannerRunStatus.FAILED, versionText, -1, started, startedNanos,
                    List.of(), scan.error());
        }
        if (scan.timedOut()) {
            return result(request, ScannerRunStatus.TIMED_OUT, versionText, -1, started, startedNanos,
                    List.of(), "scan timed out after " + request.timeoutSeconds() + " seconds");
        }
        if (scan.exitCode() != 0 && scan.exitCode() != 1) {
            return result(request, ScannerRunStatus.FAILED, versionText, scan.exitCode(), started, startedNanos,
                    List.of(), "scan exited with code " + scan.exitCode());
        }
        try {
            if (!Files.isRegularFile(output)) {
                throw new ExternalFindingImportException("Semgrep did not create results.json");
            }
            if (Files.size(output) > properties.maxOutputBytes()) {
                return result(request, ScannerRunStatus.FAILED, versionText, scan.exitCode(), started, startedNanos,
                        List.of(), "scanner output exceeds configured limit");
            }
            List<ExternalFinding> findings;
            try (var input = Files.newInputStream(output)) {
                findings = importer.importJson(input, properties.maxFindings());
            }
            return result(request, ScannerRunStatus.SUCCEEDED, versionText, scan.exitCode(), started, startedNanos,
                    findings, "");
        } catch (IOException | ExternalFindingImportException e) {
            return result(request, ScannerRunStatus.FAILED, versionText, scan.exitCode(), started, startedNanos,
                    List.of(), "failed to import Semgrep output: " + safeMessage(e));
        }
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
        Path runDir = root.resolve(scanId).resolve("semgrep").normalize();
        if (!runDir.startsWith(root)) {
            throw new IllegalArgumentException("scan output path escapes controlled root");
        }
        return runDir;
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

}

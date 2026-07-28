package com.repograph.scanner;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 包内共享的受控 CLI 进程执行器。
 *
 * <p>统一使用参数数组、独立 stdout/stderr 文件、强制超时和中断清理，
 * 避免适配器各自维护进程细节。
 */
final class CliProcessRunner {

    private CliProcessRunner() {}

    static ProbeOutcome probe(String command, Path probeDir, long timeoutSeconds) {
        Path stdout = null;
        Path stderr = null;
        try {
            Files.createDirectories(probeDir);
            stdout = Files.createTempFile(probeDir, "version-", ".stdout");
            stderr = Files.createTempFile(probeDir, "version-", ".stderr");
            ProcessOutcome outcome = run(
                    List.of(command, "--version"), probeDir, stdout, stderr, timeoutSeconds);
            if (!outcome.started() || outcome.timedOut() || outcome.exitCode() != 0) {
                return new ProbeOutcome(false, "", probeError(outcome));
            }
            return new ProbeOutcome(true, firstLine(stdout), "");
        } catch (IOException e) {
            return new ProbeOutcome(false, "", safeMessage(e));
        } finally {
            deleteQuietly(stdout);
            deleteQuietly(stderr);
        }
    }

    static ProcessOutcome run(
            List<String> command,
            Path workingDirectory,
            Path stdout,
            Path stderr,
            long timeoutSeconds) {
        Process process = null;
        try {
            process = new ProcessBuilder(command)
                    .directory(workingDirectory.toFile())
                    .redirectOutput(stdout.toFile())
                    .redirectError(stderr.toFile())
                    .start();
            boolean finished = process.waitFor(Math.max(1, timeoutSeconds), TimeUnit.SECONDS);
            if (!finished) {
                terminate(process);
                return new ProcessOutcome(true, true, -1, "");
            }
            return new ProcessOutcome(true, false, process.exitValue(), "");
        } catch (IOException e) {
            return new ProcessOutcome(false, false, -1, safeMessage(e));
        } catch (InterruptedException e) {
            if (process != null) {
                terminate(process);
            }
            Thread.currentThread().interrupt();
            return new ProcessOutcome(false, false, -1, "scanner execution interrupted");
        }
    }

    static String firstLine(Path path) {
        try (var lines = Files.lines(path)) {
            return lines.findFirst().orElse("").trim();
        } catch (IOException e) {
            return "";
        }
    }

    private static void terminate(Process process) {
        process.destroyForcibly();
        try {
            process.waitFor(5, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String probeError(ProcessOutcome outcome) {
        if (!outcome.started()) {
            return outcome.error();
        }
        if (outcome.timedOut()) {
            return "version probe timed out";
        }
        return "version probe exited with code " + outcome.exitCode();
    }

    private static void deleteQuietly(Path path) {
        if (path == null) {
            return;
        }
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
            // 探测临时日志不影响能力结果，扫描工作目录删除时会统一清理。
        }
    }

    private static String safeMessage(Exception exception) {
        return exception.getMessage() == null || exception.getMessage().isBlank()
                ? exception.getClass().getSimpleName()
                : exception.getMessage();
    }

    record ProcessOutcome(boolean started, boolean timedOut, int exitCode, String error) {}

    record ProbeOutcome(boolean available, String version, String error) {}
}

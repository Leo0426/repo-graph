package com.repograph.advisory;

import com.repograph.core.advisory.LlmAdvisoryAuditEvent;
import com.repograph.core.advisory.LlmAdvisoryAuditSink;
import com.repograph.core.advisory.LlmAdvisoryEvidence;
import com.repograph.core.advisory.LlmAdvisoryModel;
import com.repograph.core.advisory.LlmAdvisoryRequest;
import com.repograph.core.advisory.LlmAdvisoryResult;
import com.repograph.core.advisory.LlmAdvisoryService;
import com.repograph.core.advisory.LlmAdvisorySettings;
import com.repograph.core.advisory.LlmAdvisorySettingsService;
import com.repograph.core.advisory.LlmAdvisoryStatus;
import com.repograph.core.advisory.LlmModelException;
import com.repograph.core.advisory.LlmModelResponse;
import com.repograph.core.advisory.LlmUsage;
import com.repograph.core.finding.TriageReport;
import com.repograph.core.retrieval.ContextEvidence;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 受约束的 LLM 辅助复核服务。
 *
 * <p>该服务在调用前执行预算和脱敏，在调用后执行 citation 白名单校验。
 * 任何分支都只返回建议，不修改原始启发式报告或漏洞状态。
 *
 * @author leolu
 */
@Service
public class DefaultLlmAdvisoryService implements LlmAdvisoryService {

    private static final Pattern SECRET_ASSIGNMENT = Pattern.compile(
            "(?i)(password|passwd|secret|token|api[_-]?key)\\s*[:=]\\s*(\"[^\"]*\"|'[^']*'|[^\\s;,]+)");
    private static final Pattern BEARER_TOKEN = Pattern.compile("(?i)bearer\\s+[a-z0-9._~+/=-]+");
    private static final String REDACTED = "[REDACTED]";

    private final LlmAdvisoryModel model;
    private final LlmAdvisoryProperties properties;
    private final LlmAdvisorySettingsService settingsService;
    private final ExecutorService executor;
    private final LlmAdvisoryAuditSink auditSink;
    private final Clock clock;

    /**
     * 创建受约束辅助复核服务。
     *
     * @param model      提供方中立模型适配器
     * @param properties 安全与资源边界
     * @param settingsService 页面运行时设置
     * @param executor        专用有界执行器
     * @param auditSink       无源码审计出口
     */
    @Autowired
    public DefaultLlmAdvisoryService(
            LlmAdvisoryModel model,
            LlmAdvisoryProperties properties,
            LlmAdvisorySettingsService settingsService,
            @Qualifier("llmAdvisoryExecutor") ExecutorService executor,
            LlmAdvisoryAuditSink auditSink) {
        this(model, properties, settingsService, executor, auditSink, Clock.systemUTC());
    }

    /**
     * 创建可注入时钟的辅助复核服务。
     *
     * @param model      模型适配器
     * @param properties 安全与资源边界
     * @param settingsService 页面运行时设置
     * @param executor   专用执行器
     * @param auditSink  审计出口
     * @param clock      审计时钟
     */
    public DefaultLlmAdvisoryService(
            LlmAdvisoryModel model,
            LlmAdvisoryProperties properties,
            LlmAdvisorySettingsService settingsService,
            ExecutorService executor,
            LlmAdvisoryAuditSink auditSink,
            Clock clock) {
        this.model = Objects.requireNonNull(model, "model");
        this.properties = Objects.requireNonNull(properties, "properties");
        this.settingsService = Objects.requireNonNull(settingsService, "settingsService");
        this.executor = Objects.requireNonNull(executor, "executor");
        this.auditSink = Objects.requireNonNull(auditSink, "auditSink");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    /**
     * 创建使用启动配置开关的兼容实例，主要供独立测试和非 Spring 调用使用。
     *
     * @param model      模型适配器
     * @param properties 安全与资源边界
     * @param executor   专用执行器
     * @param auditSink  审计出口
     * @param clock      审计时钟
     */
    public DefaultLlmAdvisoryService(
            LlmAdvisoryModel model,
            LlmAdvisoryProperties properties,
            ExecutorService executor,
            LlmAdvisoryAuditSink auditSink,
            Clock clock) {
        this(model, properties, new StartupSettingsService(properties), executor, auditSink, clock);
    }

    /**
     * 创建默认关闭的辅助复核服务。
     *
     * @return 不执行模型调用的服务
     */
    public static DefaultLlmAdvisoryService disabled() {
        return new DefaultLlmAdvisoryService(
                new DisabledLlmAdvisoryModel(),
                LlmAdvisoryProperties.defaults(),
                java.util.concurrent.Executors.newSingleThreadExecutor(),
                event -> {},
                Clock.systemUTC());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public LlmAdvisoryResult review(TriageReport heuristicReport) {
        TriageReport report = Objects.requireNonNull(heuristicReport, "heuristicReport");
        if (!settingsService.current().enabled() || !model.available()) {
            return LlmAdvisoryResult.disabled(report);
        }

        String requestId = UUID.randomUUID().toString();
        long startedNanos = System.nanoTime();
        PreparedRequest prepared = prepareRequest(requestId, report);
        double estimatedCost = model.estimateCostUsd(
                prepared.inputChars(),
                properties.maxOutputChars());
        if (estimatedCost > properties.maxEstimatedCostUsd()) {
            LlmAdvisoryResult result = failureResult(
                    report,
                    LlmAdvisoryStatus.BUDGET_EXCEEDED,
                    "模型调用的预估成本超过单次预算",
                    prepared.redactionCount(),
                    0,
                    elapsedMillis(startedNanos));
            audit(requestId, report, result, "COST_BUDGET");
            return result;
        }

        int attempts = 0;
        while (attempts <= properties.maxRetries()) {
            attempts++;
            Future<LlmModelResponse> future = executor.submit(() -> model.review(prepared.request()));
            try {
                LlmModelResponse response = future.get(properties.timeoutMillis(), TimeUnit.MILLISECONDS);
                LlmAdvisoryResult result = validateResponse(
                        report,
                        response,
                        prepared,
                        attempts,
                        elapsedMillis(startedNanos));
                audit(requestId, report, result, "");
                return result;
            } catch (TimeoutException timeout) {
                future.cancel(true);
                if (attempts > properties.maxRetries()) {
                    LlmAdvisoryResult result = failureResult(
                            report,
                            LlmAdvisoryStatus.TIMED_OUT,
                            "模型辅助复核超时，已保留启发式结论",
                            prepared.redactionCount(),
                            attempts,
                            elapsedMillis(startedNanos));
                    audit(requestId, report, result, "TIMEOUT");
                    return result;
                }
            } catch (InterruptedException interrupted) {
                future.cancel(true);
                Thread.currentThread().interrupt();
                LlmAdvisoryResult result = failureResult(
                        report,
                        LlmAdvisoryStatus.FAILED,
                        "模型辅助复核被中断，已保留启发式结论",
                        prepared.redactionCount(),
                        attempts,
                        elapsedMillis(startedNanos));
                audit(requestId, report, result, "INTERRUPTED");
                return result;
            } catch (ExecutionException execution) {
                future.cancel(true);
                Throwable cause = execution.getCause();
                boolean retryable = cause instanceof LlmModelException modelException
                        && modelException.retryable();
                if (!retryable || attempts > properties.maxRetries()) {
                    LlmAdvisoryResult result = failureResult(
                            report,
                            LlmAdvisoryStatus.FAILED,
                            "模型辅助复核失败，已保留启发式结论",
                            prepared.redactionCount(),
                            attempts,
                            elapsedMillis(startedNanos));
                    audit(requestId, report, result, retryable ? "RETRIES_EXHAUSTED" : "MODEL_FAILURE");
                    return result;
                }
            }
        }
        throw new IllegalStateException("unreachable LLM advisory state");
    }

    private PreparedRequest prepareRequest(String requestId, TriageReport report) {
        RedactedText fullSummary = redact(
                "tool=" + report.finding().tool()
                        + ", rule=" + report.finding().ruleId()
                        + ", cwe=" + report.finding().cwe()
                        + ", message=" + report.finding().message()
                        + ", location=" + report.finding().filePath() + ":" + report.finding().startLine());
        String summary = truncate(fullSummary.value(), properties.maxInputChars());
        int remaining = properties.maxInputChars() - summary.length();
        int redactionCount = fullSummary.count();
        List<LlmAdvisoryEvidence> evidence = new ArrayList<>();
        for (ContextEvidence item : report.pack().evidence()) {
            if (remaining == 0) {
                break;
            }
            RedactedText redacted = redact(item.excerpt());
            redactionCount += redacted.count();
            String excerpt = redacted.value();
            if (excerpt.length() > remaining) {
                excerpt = excerpt.substring(0, remaining);
            }
            evidence.add(new LlmAdvisoryEvidence(
                    item.citationId(),
                    item.filePath() + ":" + item.startLine() + "-" + item.endLine(),
                    excerpt,
                    true));
            remaining -= excerpt.length();
        }
        List<String> missing = new ArrayList<>();
        for (String item : report.missingInfo()) {
            if (remaining == 0) {
                break;
            }
            RedactedText redacted = redact(item);
            redactionCount += redacted.count();
            String bounded = truncate(redacted.value(), remaining);
            missing.add(bounded);
            remaining -= bounded.length();
        }
        int inputChars = summary.length()
                + evidence.stream().mapToInt(value -> value.excerpt().length()).sum()
                + missing.stream().mapToInt(String::length).sum();
        LlmAdvisoryRequest request = new LlmAdvisoryRequest(
                requestId,
                report.finding().fingerprint(),
                report.verdict(),
                summary,
                evidence,
                missing,
                properties.maxOutputChars());
        return new PreparedRequest(request, inputChars, redactionCount);
    }

    private LlmAdvisoryResult validateResponse(
            TriageReport report,
            LlmModelResponse response,
            PreparedRequest prepared,
            int attempts,
            long latencyMs) {
        Set<String> allowed = new LinkedHashSet<>();
        prepared.request().evidence().forEach(evidence -> allowed.add(evidence.citationId()));
        int remaining = properties.maxOutputChars();
        List<String> citations = new ArrayList<>();
        for (String citation : new LinkedHashSet<>(response.citations())) {
            if (allowed.contains(citation) && citation.length() <= remaining) {
                citations.add(citation);
                remaining -= citation.length();
            }
        }
        List<String> missing = new ArrayList<>();
        for (String item : response.missingInfo()) {
            remaining = appendBounded(missing, item, remaining);
        }
        for (String citation : new LinkedHashSet<>(response.citations())) {
            if (!allowed.contains(citation)) {
                remaining = appendBounded(
                        missing,
                        "拒绝模型引用输入中不存在的 citation: " + citation,
                        remaining);
            }
        }
        return new LlmAdvisoryResult(
                report,
                LlmAdvisoryStatus.COMPLETED,
                true,
                true,
                model.provider(),
                model.model(),
                response.suggestedVerdict(),
                response.uncertainty(),
                citations,
                missing,
                prepared.redactionCount(),
                attempts,
                latencyMs,
                response.usage());
    }

    private LlmAdvisoryResult failureResult(
            TriageReport report,
            LlmAdvisoryStatus status,
            String reason,
            int redactionCount,
            int attempts,
            long latencyMs) {
        return new LlmAdvisoryResult(
                report,
                status,
                attempts > 0,
                true,
                model.provider(),
                model.model(),
                null,
                1.0f,
                List.of(),
                List.of(reason),
                redactionCount,
                attempts,
                latencyMs,
                LlmUsage.NONE);
    }

    private RedactedText redact(String value) {
        if (!properties.redact() || value == null || value.isEmpty()) {
            return new RedactedText(value == null ? "" : value, 0);
        }
        Replacement first = replaceAll(SECRET_ASSIGNMENT, value, "$1=" + REDACTED);
        Replacement second = replaceAll(BEARER_TOKEN, first.value(), "Bearer " + REDACTED);
        return new RedactedText(second.value(), first.count() + second.count());
    }

    private static Replacement replaceAll(Pattern pattern, String value, String replacement) {
        Matcher matcher = pattern.matcher(value);
        StringBuilder result = new StringBuilder();
        int count = 0;
        while (matcher.find()) {
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
            count++;
        }
        matcher.appendTail(result);
        return new Replacement(result.toString(), count);
    }

    private static String truncate(String value, int maxChars) {
        return value.length() <= maxChars ? value : value.substring(0, maxChars);
    }

    private static int appendBounded(List<String> target, String value, int remaining) {
        if (remaining <= 0 || value == null || value.isEmpty()) {
            return remaining;
        }
        String bounded = truncate(value, remaining);
        target.add(bounded);
        return remaining - bounded.length();
    }

    private void audit(
            String requestId,
            TriageReport report,
            LlmAdvisoryResult result,
            String errorCode) {
        auditSink.record(new LlmAdvisoryAuditEvent(
                requestId,
                report.finding().fingerprint(),
                model.provider(),
                model.model(),
                result.status(),
                result.attempts(),
                result.latencyMs(),
                result.redactionCount(),
                result.usage(),
                errorCode,
                Instant.now(clock).toString()));
    }

    private static long elapsedMillis(long startedNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedNanos);
    }

    private record RedactedText(String value, int count) {}

    private record Replacement(String value, int count) {}

    private record PreparedRequest(LlmAdvisoryRequest request, int inputChars, int redactionCount) {}

    private static final class StartupSettingsService implements LlmAdvisorySettingsService {

        private final LlmAdvisorySettings settings;

        private StartupSettingsService(LlmAdvisoryProperties properties) {
            this.settings = new LlmAdvisorySettings(
                    properties.enabled(), "STATIC", "", "", Instant.EPOCH.toString());
        }

        @Override
        public LlmAdvisorySettings current() {
            return settings;
        }

        @Override
        public LlmAdvisorySettings update(
                boolean enabled, String baseUrl, String model, String updatedAt) {
            throw new UnsupportedOperationException("startup settings are immutable");
        }
    }
}

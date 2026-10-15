package com.repograph.wiki;

import com.repograph.core.agent.AgentPlaybook;
import com.repograph.core.agent.AgentRun;
import com.repograph.core.agent.AgentRunRepository;
import com.repograph.core.agent.AgentRunStatus;
import com.repograph.core.agent.AgentStep;
import com.repograph.core.agent.AgentStepStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;

/**
 * 分层摘要生成任务的编排与台账服务（S2）。
 *
 * <p>生成任务复用 AgentRun/AgentStep 记录执行状态（playbook = WIKI_SUMMARY），
 * 不另建平行台账，也不复制摘要事实。提交走专用有界执行器，队列满时抛出
 * {@link RejectedExecutionException} 由 REST 层映射为 503。
 *
 * <p>步骤：FACTS（结构事实收集）→ LLM_ARCH（架构摘要，通道关闭时 SKIPPED）→
 * PERSIST（摘要文档持久化）。
 *
 * @author leolu
 * @since 0.7.0
 */
@Service
public class WikiSummaryJobService {

    private static final Logger log = LoggerFactory.getLogger(WikiSummaryJobService.class);

    private final AgentRunRepository agentRunRepository;
    private final DefaultSummaryGenerationService generationService;
    private final ExecutorService executor;
    private final Clock clock;

    public WikiSummaryJobService(AgentRunRepository agentRunRepository,
                                 DefaultSummaryGenerationService generationService,
                                 @Qualifier("wikiSummaryExecutor") ExecutorService executor,
                                 Clock clock) {
        this.agentRunRepository = agentRunRepository;
        this.generationService = generationService;
        this.executor = executor;
        this.clock = clock;
    }

    /**
     * 提交异步生成任务。
     *
     * @param projectId 项目唯一标识符
     * @return AgentRun id（轮询 GET /api/v1/agent-runs/{id}）
     * @throws RejectedExecutionException 等待队列已满
     */
    public String submit(String projectId) {
        String runId = UUID.randomUUID().toString();
        Instant now = clock.instant();
        agentRunRepository.create(new AgentRun(
                runId, projectId, AgentPlaybook.WIKI_SUMMARY, "1",
                AgentRunStatus.QUEUED, "facts:graph:" + projectId, null, null,
                now.toString(), now.toString(), null, java.util.List.of()));
        try {
            executor.submit(() -> run(projectId, runId));
        } catch (RejectedExecutionException e) {
            agentRunRepository.transition(runId, AgentRunStatus.FAILED, null,
                    "EXECUTOR_REJECTED", clock.instant().toString());
            throw e;
        }
        return runId;
    }

    private void run(String projectId, String runId) {
        agentRunRepository.transition(runId, AgentRunStatus.RUNNING, null, null,
                clock.instant().toString());
        int[] sequence = {0};
        try {
            SummaryGenerationOutcome outcome = generationService.generateWithOutcome(projectId, true);

            recordStep(runId, sequence, "FACTS", AgentStepStatus.COMPLETED,
                    "结构事实收集完成（factsHash=" + abbreviate(outcome.factsHash()) + "）");

            if (outcome.llmUsed()) {
                recordStep(runId, sequence, "LLM_ARCH", AgentStepStatus.COMPLETED,
                        "LLM 架构摘要章节生成完成（model=" + outcome.model() + "）");
            } else if (outcome.llmRequested()) {
                recordStep(runId, sequence, "LLM_ARCH", AgentStepStatus.SKIPPED,
                        "LLM 通道未启用或无章节产出，仅生成确定性结构卡");
            } else {
                recordStep(runId, sequence, "LLM_ARCH", AgentStepStatus.SKIPPED, "未请求 LLM 章节");
            }

            recordStep(runId, sequence, "PERSIST", AgentStepStatus.COMPLETED,
                    "摘要文档持久化完成（" + outcome.documents().size() + " 份）"
                            + (outcome.missingInfo().isEmpty() ? "" : "；缺失信息 "
                            + outcome.missingInfo().size() + " 条"));

            boolean partial = outcome.llmRequested() && outcome.documents().stream()
                    .filter(d -> "__project__".equals(d.scopeId()))
                    .findFirst()
                    .map(d -> SummaryDocumentStatus.isPartial(d))
                    .orElse(false);
            agentRunRepository.transition(runId,
                    partial ? AgentRunStatus.PARTIAL : AgentRunStatus.COMPLETED,
                    "summaries:project:" + projectId, null, clock.instant().toString());
            log.info("Wiki summary run {} completed for {} ({} docs, llmUsed={})",
                    runId, projectId, outcome.documents().size(), outcome.llmUsed());
        } catch (Exception e) {
            recordStep(runId, sequence, "FACTS", AgentStepStatus.FAILED, rootMessage(e));
            agentRunRepository.transition(runId, AgentRunStatus.FAILED, null,
                    rootMessage(e), clock.instant().toString());
            log.warn("Wiki summary run {} failed for {}: {}", runId, projectId, e.getMessage());
        }
    }

    private void recordStep(String runId, int[] sequence, String capability,
                            AgentStepStatus status, String summary) {
        Instant now = clock.instant();
        agentRunRepository.saveStep(new AgentStep(
                UUID.randomUUID().toString(), runId, ++sequence[0], capability,
                status, summary, java.util.List.of(), java.util.List.of(),
                java.util.List.of(), null, now.toString(),
                status == AgentStepStatus.COMPLETED || status == AgentStepStatus.FAILED
                        ? now.toString() : null));
    }

    private static String abbreviate(String value) {
        if (value == null || value.length() <= 12) return value;
        return value.substring(0, 12) + "…";
    }

    private static String rootMessage(Exception e) {
        Throwable cause = e;
        while (cause.getCause() != null) {
            cause = cause.getCause();
        }
        return cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
    }

    /** 避免直接依赖字符串字面量判断 PARTIAL 的小工具。 */
    private static final class SummaryDocumentStatus {
        private static boolean isPartial(com.repograph.core.wiki.SummaryDocument document) {
            return com.repograph.core.wiki.SummaryDocument.STATUS_PARTIAL.equals(document.status());
        }
    }
}

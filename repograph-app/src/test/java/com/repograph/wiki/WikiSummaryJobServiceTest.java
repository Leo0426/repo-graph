package com.repograph.wiki;

import com.repograph.core.agent.AgentPlaybook;
import com.repograph.core.agent.AgentRun;
import com.repograph.core.agent.AgentRunRepository;
import com.repograph.core.agent.AgentRunStatus;
import com.repograph.core.agent.AgentStep;
import com.repograph.core.agent.AgentStepStatus;
import com.repograph.core.wiki.SummaryDocument;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.RejectedExecutionException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link WikiSummaryJobService} 单元测试：验证 AgentRun 台账流转、步骤记录、
 * 队列拒绝语义与失败路径。
 *
 * @author leolu
 * @since 0.7.0
 */
@ExtendWith(MockitoExtension.class)
class WikiSummaryJobServiceTest {

    @Mock
    AgentRunRepository agentRunRepository;

    @Mock
    DefaultSummaryGenerationService generationService;

    private Clock clock;

    private WikiSummaryJobService service;

    @BeforeEach
    void setUp() {
        clock = Clock.fixed(Instant.parse("2026-10-15T10:00:00Z"), ZoneOffset.UTC);
        service = new WikiSummaryJobService(agentRunRepository, generationService,
                inlineExecutor(), clock);
    }

    /** execute() 直接在当前线程运行的执行器，保证验证同步、无竞态。 */
    private static java.util.concurrent.ExecutorService inlineExecutor() {
        return new java.util.concurrent.AbstractExecutorService() {
            @Override
            public void execute(Runnable command) {
                command.run();
            }

            @Override
            public void shutdown() {
            }

            @Override
            public List<Runnable> shutdownNow() {
                return List.of();
            }

            @Override
            public boolean isShutdown() {
                return false;
            }

            @Override
            public boolean isTerminated() {
                return false;
            }

            @Override
            public boolean awaitTermination(long timeout, java.util.concurrent.TimeUnit unit) {
                return true;
            }
        };
    }

    /** execute() 直接拒绝的执行器，模拟队列已满。 */
    private static java.util.concurrent.ExecutorService rejectingExecutor() {
        return new java.util.concurrent.AbstractExecutorService() {
            @Override
            public void execute(Runnable command) {
                throw new RejectedExecutionException("queue full");
            }

            @Override
            public void shutdown() {
            }

            @Override
            public List<Runnable> shutdownNow() {
                return List.of();
            }

            @Override
            public boolean isShutdown() {
                return false;
            }

            @Override
            public boolean isTerminated() {
                return false;
            }

            @Override
            public boolean awaitTermination(long timeout, java.util.concurrent.TimeUnit unit) {
                return true;
            }
        };
    }

    private void stubOutcome(SummaryGenerationOutcome outcome) {
        when(generationService.generateWithOutcome("proj1", true)).thenReturn(outcome);
    }

    @Test
    void submit_createsRun_executesInline_andCompletes() {
        stubOutcome(new SummaryGenerationOutcome(
                List.of(new SummaryDocument("d1", "proj1",
                        com.repograph.core.wiki.SummaryLevel.PROJECT, "__project__", "t",
                        List.of(), List.of(), 1, "2026-10-15T10:00:00Z",
                        com.repograph.core.wiki.SummaryDocument.STATUS_COMPLETED)),
                "hash", true, true, "m1", List.of()));

        String runId = service.submit("proj1");

        assertThat(runId).isNotBlank();
        verify(agentRunRepository).create(org.mockito.ArgumentMatchers.argThat(
                (AgentRun run) -> run.playbook() == AgentPlaybook.WIKI_SUMMARY
                        && run.status() == AgentRunStatus.QUEUED));
        verify(agentRunRepository).transition(eq(runId), eq(AgentRunStatus.RUNNING),
                isNull(), isNull(), any());
        verify(agentRunRepository).transition(eq(runId), eq(AgentRunStatus.COMPLETED),
                eq("summaries:project:proj1"), isNull(), any());

        ArgumentCaptor<AgentStep> steps = ArgumentCaptor.forClass(AgentStep.class);
        verify(agentRunRepository, org.mockito.Mockito.atLeastOnce()).saveStep(steps.capture());
        assertThat(steps.getAllValues().stream().map(AgentStep::capability))
                .containsExactly("FACTS", "LLM_ARCH", "PERSIST");
        assertThat(steps.getAllValues().stream().allMatch(
                s -> s.status() == AgentStepStatus.COMPLETED)).isTrue();
    }

    @Test
    void submit_llmDisabled_marksLlmStepSkipped() {
        stubOutcome(new SummaryGenerationOutcome(
                List.of(), "hash", true, false, null, List.of()));

        String runId = service.submit("proj1");

        ArgumentCaptor<AgentStep> steps = ArgumentCaptor.forClass(AgentStep.class);
        verify(agentRunRepository, org.mockito.Mockito.atLeastOnce()).saveStep(steps.capture());
        assertThat(steps.getAllValues().stream()
                .filter(s -> "LLM_ARCH".equals(s.capability()))
                .findFirst().orElseThrow().status()).isEqualTo(AgentStepStatus.SKIPPED);
        verify(agentRunRepository).transition(eq(runId), eq(AgentRunStatus.COMPLETED),
                any(), isNull(), any());
    }

    @Test
    void submit_generationFailure_failsRun() {
        when(generationService.generateWithOutcome("proj1", true))
                .thenThrow(new IllegalStateException("collector exploded"));

        String runId = service.submit("proj1");

        verify(agentRunRepository).transition(eq(runId), eq(AgentRunStatus.FAILED),
                isNull(), eq("collector exploded"), any());
    }

    @Test
    void submit_queueFull_rejects_andFailsRun() {
        WikiSummaryJobService rejecting = new WikiSummaryJobService(
                agentRunRepository, generationService, rejectingExecutor(), clock);

        assertThatThrownBy(() -> rejecting.submit("proj1"))
                .isInstanceOf(RejectedExecutionException.class);
        verify(agentRunRepository).transition(any(), eq(AgentRunStatus.FAILED),
                isNull(), eq("EXECUTOR_REJECTED"), any());
    }
}

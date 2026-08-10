package com.repograph.api;

import com.repograph.agent.AgentRunStore;
import com.repograph.agent.SastTriageAgentCommand;
import com.repograph.agent.SastTriageAgentService;
import com.repograph.agent.VulnerabilityNotFoundException;
import com.repograph.agent.VulnerabilityTriageAgentCommand;
import com.repograph.core.agent.AgentPlaybook;
import com.repograph.core.agent.AgentRun;
import com.repograph.core.agent.AgentRunStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link AgentRunController} REST 契约测试。
 *
 * @author leolu
 */
@WebMvcTest(AgentRunController.class)
class AgentRunControllerTest {

    private final MockMvc mvc;

    @MockitoBean
    SastTriageAgentService agentService;

    @MockitoBean
    AgentRunStore runStore;

    @Autowired
    AgentRunControllerTest(MockMvc mvc) {
        this.mvc = mvc;
    }

    @Test
    void startAcceptsRawFindingJsonAndReturnsQueuedRun() throws Exception {
        when(agentService.start(any(SastTriageAgentCommand.class))).thenReturn(run("run-1"));

        mvc.perform(post("/api/v1/agent-runs/sast-triage")
                        .param("projectId", "project-1")
                        .param("format", "semgrep")
                        .param("codeVersion", "abc123")
                        .contentType("application/json")
                        .content("{\"results\":[]}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.id").value("run-1"))
                .andExpect(jsonPath("$.playbook").value("SAST_TRIAGE"))
                .andExpect(jsonPath("$.status").value("QUEUED"));
    }

    @Test
    void startSelectedVulnerabilityReturnsAcceptedRun() throws Exception {
        when(agentService.start(any(VulnerabilityTriageAgentCommand.class))).thenReturn(run("run-2"));

        mvc.perform(post("/api/v1/agent-runs/vulnerability-triage")
                        .param("vulnerabilityId", "vuln-1")
                        .param("codeVersion", "abc123"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.id").value("run-2"));
    }

    @Test
    void startSelectedVulnerabilityReturnsNotFoundForStaleSelection() throws Exception {
        when(agentService.start(any(VulnerabilityTriageAgentCommand.class)))
                .thenThrow(new VulnerabilityNotFoundException("vuln-1"));

        mvc.perform(post("/api/v1/agent-runs/vulnerability-triage")
                        .param("vulnerabilityId", "vuln-1"))
                .andExpect(status().isNotFound());
    }

    @Test
    void listAndGetExposeRunHistory() throws Exception {
        when(runStore.list("project-1", 20)).thenReturn(List.of(run("run-1")));
        when(runStore.get("run-1")).thenReturn(Optional.of(run("run-1")));

        mvc.perform(get("/api/v1/agent-runs")
                        .param("projectId", "project-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("run-1"));

        mvc.perform(get("/api/v1/agent-runs/run-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inputReference").value("upload:semgrep"));
    }

    @Test
    void getReturnsNotFoundForUnknownRun() throws Exception {
        when(runStore.get("missing")).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/agent-runs/missing"))
                .andExpect(status().isNotFound());
    }

    private static AgentRun run(String id) {
        return new AgentRun(id, "project-1", AgentPlaybook.SAST_TRIAGE, "1",
                AgentRunStatus.QUEUED, "upload:semgrep", "", "",
                "2026-08-09T03:00:00Z", "2026-08-09T03:00:00Z", "", List.of());
    }
}

package com.repograph.api;

import com.repograph.agent.AgentRunStore;
import com.repograph.agent.SastTriageAgentCommand;
import com.repograph.agent.SastTriageAgentService;
import com.repograph.agent.VulnerabilityNotFoundException;
import com.repograph.agent.VulnerabilityTriageAgentCommand;
import com.repograph.core.agent.AgentRun;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 平台 Agent 运行 REST API，提供 Playbook 启动、运行列表和可观察时间线查询。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/agent-runs")
public class AgentRunController {

    private final SastTriageAgentService agentService;
    private final AgentRunStore runStore;

    /**
     * 创建 Agent 运行控制器。
     *
     * @param agentService SAST 研判 Agent 服务
     * @param runStore     Agent 运行存储
     */
    public AgentRunController(SastTriageAgentService agentService, AgentRunStore runStore) {
        this.agentService = agentService;
        this.runStore = runStore;
    }

    /**
     * 接受一次 SAST 研判 Playbook 运行。
     *
     * @param projectId   项目标识
     * @param format      报警格式，如 semgrep 或 sarif
     * @param codeVersion 当前代码版本
     * @param ruleVersion 当前规则版本
     * @param budgetChars 单条报警上下文预算
     * @param maxFindings 最大处理报警数
     * @param findingsJson 外部工具原始 JSON
     * @return 已接受的 Agent 运行
     */
    @PostMapping("/sast-triage")
    public ResponseEntity<AgentRun> startSastTriage(
            @RequestParam String projectId,
            @RequestParam String format,
            @RequestParam(required = false) String codeVersion,
            @RequestParam(required = false) String ruleVersion,
            @RequestParam(defaultValue = "12000") int budgetChars,
            @RequestParam(defaultValue = "10") int maxFindings,
            @RequestBody String findingsJson) {
        AgentRun run = agentService.start(new SastTriageAgentCommand(
                projectId, format, findingsJson, codeVersion, ruleVersion, budgetChars, maxFindings));
        return ResponseEntity.accepted().body(run);
    }

    /**
     * 从平台已有漏洞记录启动单条研判。
     *
     * @param vulnerabilityId 漏洞记录标识
     * @param codeVersion      当前代码版本
     * @param ruleVersion      当前规则版本
     * @param budgetChars      上下文字符预算
     * @return 已接受的 Agent 运行
     */
    @PostMapping("/vulnerability-triage")
    public ResponseEntity<AgentRun> startVulnerabilityTriage(
            @RequestParam String vulnerabilityId,
            @RequestParam(required = false) String codeVersion,
            @RequestParam(required = false) String ruleVersion,
            @RequestParam(defaultValue = "12000") int budgetChars) {
        AgentRun run = agentService.start(new VulnerabilityTriageAgentCommand(
                vulnerabilityId, codeVersion, ruleVersion, budgetChars));
        return ResponseEntity.accepted().body(run);
    }

    /**
     * 将已失效的漏洞选择转换为 HTTP 404。
     *
     * @return 空的 404 响应
     */
    @ExceptionHandler(VulnerabilityNotFoundException.class)
    public ResponseEntity<Void> handleVulnerabilityNotFound() {
        return ResponseEntity.notFound().build();
    }

    /**
     * 查询项目最近的 Agent 运行。
     *
     * @param projectId 项目标识
     * @param limit     最大返回数量
     * @return 按创建时间倒序的运行列表
     */
    @GetMapping
    public List<AgentRun> list(
            @RequestParam String projectId,
            @RequestParam(defaultValue = "20") int limit) {
        return runStore.list(projectId, limit);
    }

    /**
     * 查询一次 Agent 运行及步骤时间线。
     *
     * @param runId 运行标识
     * @return 运行详情；不存在时返回 404
     */
    @GetMapping("/{runId}")
    public ResponseEntity<AgentRun> get(@PathVariable String runId) {
        return runStore.get(runId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}

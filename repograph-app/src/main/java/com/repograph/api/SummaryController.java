package com.repograph.api;

import com.repograph.core.wiki.SummaryDocument;
import com.repograph.core.wiki.SummaryTreeNode;
import com.repograph.wiki.SummaryStore;
import com.repograph.wiki.WikiSummaryJobService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 分层摘要（结构卡 + LLM 架构摘要 + 包摘要）REST API。
 *
 * <p>generate 提交后台任务（S2 起为异步）：202 返回 AgentRun id，
 * 通过 GET /api/v1/agent-runs/{id} 轮询进度；文档就绪后经 list/tree/get 读取。
 *
 * @author leolu
 * @since 0.7.0
 */
@RestController
@RequestMapping("/api/v1/summaries")
public class SummaryController {

    private final WikiSummaryJobService jobService;
    private final SummaryStore store;

    public SummaryController(WikiSummaryJobService jobService, SummaryStore store) {
        this.jobService = jobService;
        this.store = store;
    }

    /**
     * 提交异步生成任务（结构事实 + LLM 架构摘要 + 包摘要）。
     *
     * @param projectId 项目唯一标识符
     * @return 202，含 agentRunId 与轮询地址
     */
    @PostMapping("/generate")
    public ResponseEntity<Map<String, String>> generate(@RequestParam String projectId) {
        String runId = jobService.submit(projectId);
        return ResponseEntity.accepted().body(Map.of(
                "agentRunId", runId,
                "projectId", projectId,
                "pollVia", "/api/v1/agent-runs/" + runId));
    }

    /**
     * 列出项目所有范围的最新版本摘要。
     *
     * @param projectId 项目唯一标识符
     * @return 摘要文档列表（PROJECT 级在前）
     */
    @GetMapping
    public List<SummaryDocument> list(@RequestParam String projectId) {
        return store.listLatest(projectId);
    }

    /**
     * 文档树（DeepMap FileNode 简化版）。
     *
     * @param projectId 项目唯一标识符
     * @return 树节点列表
     */
    @GetMapping("/tree")
    public List<SummaryTreeNode> tree(@RequestParam String projectId) {
        return store.listLatest(projectId).stream()
                .map(SummaryTreeNode::from)
                .toList();
    }

    /**
     * 按 id 获取单份摘要文档。
     *
     * @param id 文档 id
     * @return 摘要文档；不存在时 404
     */
    @GetMapping("/{id}")
    public ResponseEntity<SummaryDocument> get(@PathVariable String id) {
        return store.findById(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}

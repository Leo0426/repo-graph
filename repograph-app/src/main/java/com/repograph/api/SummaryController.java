package com.repograph.api;

import com.repograph.core.wiki.SummaryDocument;
import com.repograph.core.wiki.SummaryGenerationService;
import com.repograph.core.wiki.SummaryTreeNode;
import com.repograph.wiki.SummaryStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 分层摘要（结构卡 + 包摘要）REST API —— DeepMap 借鉴设计 S1 切片。
 *
 * <p>S1 为确定性生成（无 LLM），generate 同步执行并返回全部文档；
 * S2 引入 LLM 架构摘要后 generate 将切换为 202 + 后台执行。
 *
 * @author leolu
 * @since 0.7.0
 */
@RestController
@RequestMapping("/api/v1/summaries")
public class SummaryController {

    private final SummaryGenerationService generationService;
    private final SummaryStore store;

    public SummaryController(SummaryGenerationService generationService, SummaryStore store) {
        this.generationService = generationService;
        this.store = store;
    }

    /**
     * 为项目生成分层摘要并持久化（同步，无 LLM）。
     *
     * @param projectId 项目唯一标识符
     * @return 生成的全部摘要文档（项目级 + 各包级）
     */
    @PostMapping("/generate")
    public List<SummaryDocument> generate(@RequestParam String projectId) {
        return generationService.generate(projectId);
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

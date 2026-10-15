package com.repograph.core.wiki;

import java.util.List;

/**
 * 分层摘要生成服务契约：基于图谱事实为项目生成结构卡与包级确定性摘要。
 *
 * <p>输入只来自图查询与指标事实源（GraphQueryService / GraphDiagnosticsService /
 * ComplexityAnalyzer 等），输出是确定性的组织与归纳，不引入模型生成内容。
 * 生成结果由调用方负责持久化（SummaryStore）；同一 (projectId, scopeId) 每次生成
 * 产生递增的 docVersion。
 *
 * <p>后续 LLM 架构摘要（S2）在同一契约上扩展，遵守"模型输出不改启发式事实"边界。
 *
 * @author leolu
 * @since 0.7.0
 */
public interface SummaryGenerationService {

    /**
     * 为指定项目生成完整分层摘要：项目级结构卡 + 每个包的确定性子摘要。
     *
     * <p>项目未索引（图内无单元）时返回空列表，不抛异常。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     * @return 生成的摘要文档列表（含持久化后的 id 与 docVersion），不为 {@code null}
     */
    List<SummaryDocument> generate(String projectId);
}

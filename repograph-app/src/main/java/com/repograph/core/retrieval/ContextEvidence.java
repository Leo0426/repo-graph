package com.repograph.core.retrieval;

import java.util.List;

/**
 * 面向 LLM Agent 的单条上下文证据，包含可引用位置、检索来源和预算裁剪后的源码片段。
 *
 * @param citationId       本次上下文包内稳定引用 ID，如 {@code C1}
 * @param qualifiedName    代码单元或文档章节全限定名
 * @param kind             CodeUnitKind 字符串形式
 * @param language         语言标识，如 {@code java}、{@code c}、{@code python}、{@code doc}
 * @param filePath         项目内相对路径
 * @param startLine        起始行，1-based
 * @param endLine          结束行，1-based
 * @param source           检索来源，如 {@code VECTOR}、{@code CALL_GRAPH}、{@code IMPACT}
 * @param relation         与种子的关系，如 {@code SEED}、{@code CALLER}、{@code CALLEE}
 * @param finalScore       GraphRAG 综合分
 * @param excerpt          预算裁剪后的源码或文档片段
 * @param truncated        片段是否因预算被截断
 * @param securitySignals  安全相关信号列表
 * @author leolu
 */
public record ContextEvidence(
        String citationId,
        String qualifiedName,
        String kind,
        String language,
        String filePath,
        int startLine,
        int endLine,
        String source,
        String relation,
        float finalScore,
        String excerpt,
        boolean truncated,
        List<String> securitySignals
) {}

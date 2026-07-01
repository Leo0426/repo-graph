package com.repograph.core.retrieval;

import com.repograph.core.model.CodeUnit;

import java.util.List;

/**
 * GraphRAG 检索的单条结果，携带向量分、安全分、最终综合分及来源信息。
 *
 * @param unit           匹配的代码单元
 * @param vectorScore    向量相似度分（仅向量种子有值，调用图展开结果为 0）
 * @param securityScore  安全信号评分 [0, 1]，越高表示安全敏感度越强
 * @param finalScore     综合排序分，由向量分与安全分加权合成
 * @param source         来源：{@code VECTOR}、{@code CALL_GRAPH}、{@code IMPACT}
 * @param relation       与种子的关系：{@code SEED}、{@code CALLER}、{@code CALLEE}、{@code IMPACT}
 * @param securitySignals 触发安全加分的具体信号列表（如 {@code "entry_point"}、{@code "sql_operation"}）
 * @author leolu
 */
public record RankedUnit(
        CodeUnit unit,
        float vectorScore,
        float securityScore,
        float finalScore,
        String source,
        String relation,
        List<String> securitySignals
) {}

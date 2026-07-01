package com.repograph.core.parser;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.RelationEdge;

import java.util.List;

/**
 * 解析器的完整输出，包含符号单元列表、关系边列表和解析来源元数据。
 *
 * <p>精确解析器（JavaParser、Tree-sitter）在解析单个文件时同步产出两个列表；
 * 启发式解析器只产出 {@code units}，{@code edges} 始终为空列表。
 *
 * <p>{@code parserUsed} 记录实际产出结果的解析器类名，{@code degraded} 标记是否从精确解析器
 * 降级到了启发式解析器。调用方可用这两个字段做审计日志和统计。
 *
 * @param units      从文件中提取的 {@link CodeUnit} 列表；无可识别符号时为空列表，不为 {@code null}
 * @param edges      从文件中提取的 {@link RelationEdge} 列表；启发式解析器返回空列表，不为 {@code null}
 * @param parserUsed 实际产出结果的解析器类名（如 {@code "JavaCodeParser"}）；未知时为 {@code null}
 * @param degraded   {@code true} 表示精确解析器失败或返回空结果，已降级为启发式解析器
 * @author leolu
 * @since 0.1.0
 */
public record ParseResult(
        List<CodeUnit> units,
        List<RelationEdge> edges,
        String parserUsed,
        boolean degraded) {

    /**
     * 创建空解析结果（解析器内部失败路径使用）。
     *
     * @return 两个列表均为空、parserUsed 为 {@code null}、degraded 为 {@code false} 的实例
     */
    public static ParseResult empty() {
        return new ParseResult(List.of(), List.of(), null, false);
    }

    /**
     * 创建正常解析结果，由各解析器在成功路径上调用。
     *
     * @param units      提取到的 CodeUnit 列表，不为 {@code null}
     * @param edges      提取到的 RelationEdge 列表，不为 {@code null}
     * @param parserUsed 解析器类名，不为 {@code null}
     * @return degraded 为 {@code false} 的解析结果
     */
    public static ParseResult of(List<CodeUnit> units, List<RelationEdge> edges, String parserUsed) {
        return new ParseResult(units, edges, parserUsed, false);
    }

    /**
     * 返回标记了 {@code degraded=true} 的副本，由 {@link ParseStrategy#AUTO} 降级路径调用。
     *
     * @return 与当前实例相同内容但 degraded 为 {@code true} 的新实例
     */
    public ParseResult withDegraded() {
        return new ParseResult(this.units, this.edges, this.parserUsed, true);
    }
}

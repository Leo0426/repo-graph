package com.repograph.core.pipeline;

import java.util.List;

/**
 * 索引管道执行结果，包含统计数据和错误摘要。
 *
 * @param totalFiles    扫描到的源文件总数
 * @param parsedFiles   实际执行解析的文件数（增量模式下跳过未变更文件后的数量）
 * @param skippedFiles  因 MD5 未变更而跳过的文件数（仅增量模式有意义）
 * @param degradedFiles 精确解析器失败或返回空结果、已降级为启发式解析器的文件数
 * @param totalUnits    成功提取的 {@link com.repograph.core.model.CodeUnit} 总数
 * @param totalEdges    成功提取的 {@link com.repograph.core.model.RelationEdge} 总数
 * @param durationMs    整个索引流程耗时（毫秒）
 * @param errors        人类可读的错误摘要列表（不含堆栈跟踪）；无错误时为空列表，不为 {@code null}
 * @author leolu
 * @since 0.1.0
 */
public record IndexResult(
        int totalFiles,
        int parsedFiles,
        int skippedFiles,
        int degradedFiles,
        int totalUnits,
        int totalEdges,
        long durationMs,
        List<String> errors
) {}

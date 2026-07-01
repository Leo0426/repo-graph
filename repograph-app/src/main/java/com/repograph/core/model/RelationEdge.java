package com.repograph.core.model;

/**
 * 表示代码知识图谱中两个符号之间的有向关系边。
 *
 * <p>当调用目标无法在当前 repo 内解析时，{@code targetId} 保留裸名称（方法名或类名）。
 * Java 跨文件方法调用可附带内部参数数量标记（如 {@code Type#method::arity=2}），供图写入阶段
 * 在项目内唯一匹配重载；无法唯一匹配时仍不建立 CALLS 边。
 *
 * @param sourceId   源节点 ID，对应 {@link CodeUnit#id()}
 * @param targetId   目标节点 ID；若 {@code resolved=false}，则为无法解析的裸符号名称
 * @param kind       边类型，见 {@link EdgeKind}
 * @param resolved   {@code true} 表示目标已在 repo 内找到并精确绑定；
 *                   {@code false} 表示目标未解析，仅保留裸名称
 * @param filePath   边来源文件的相对路径，用于增量删除时按文件清除相关边
 * @param sourceLine 边来源行号，1-based
 * @author leolu
 * @since 0.1.0
 */
public record RelationEdge(
        String sourceId,
        String targetId,
        EdgeKind kind,
        boolean resolved,
        String filePath,
        int sourceLine
) {}

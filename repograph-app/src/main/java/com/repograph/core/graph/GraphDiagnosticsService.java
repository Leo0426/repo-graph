package com.repograph.core.graph;

import com.repograph.core.model.CodeUnit;

import java.util.List;

/**
 * 代码图诊断查询接口：批量扫描目标提取、跨类调用边、死代码和测试空白检测。
 *
 * <p>与 {@link GraphQueryService} 的区别：该接口聚焦于"对图做批量诊断扫描"，
 * 而 {@link GraphQueryService} 只负责结构化图遍历（callers / callees / impact / subtypes）。
 *
 * <p>所有方法在无结果时返回空集合，不返回 {@code null}，也不抛出异常。
 *
 * @author leolu
 * @since 0.6.0
 */
public interface GraphDiagnosticsService {

    /**
     * 列出指定项目内适合漏洞扫描的代码单元（METHOD / CONSTRUCTOR / FUNCTION，且含 rawSource）。
     *
     * @param projectId 项目唯一标识符
     * @return 可供逐行分析的代码单元列表；无结果时返回空列表，不为 {@code null}
     */
    List<CodeUnit> listScanTargets(String projectId);

    /**
     * 返回指定项目内所有跨类调用边，供类级别耦合度分析使用。
     *
     * <p>仅返回调用方与被调用方属于不同类的边（忽略同类内部调用）。
     * 每条边形如 {@code (callerClass, calleeClass)}，唯一去重（DISTINCT）。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     * @return 跨类调用边列表；无结果时返回空列表，不为 {@code null}
     */
    List<ClassEdge> findClassCallEdges(String projectId);

    /**
     * 查找指定项目中潜在的死代码单元：在图中不存在任何 {@code CALLS} 入边的 METHOD / FUNCTION，
     * 且不是已知入口点（{@code is_entry_point=true}）。
     *
     * <p>死代码检测基于图拓扑，属于启发式分析，反射/动态代理调用可能造成误报。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     * @return 疑似死代码的代码单元列表；无结果时返回空列表，不为 {@code null}
     */
    List<CodeUnit> findDeadCode(String projectId);

    /**
     * 查找指定项目中没有任何测试覆盖路径的生产方法（测试空白 / Test Gap）。
     *
     * <p>从所有 {@code is_test='true'} 的测试单元出发，沿 {@code CALLS} 边向下遍历（深度上限 6），
     * 收集可达方法集合，返回不在该集合内的非测试生产代码单元。
     *
     * @param projectId 项目唯一标识符，不为 {@code null}
     * @return 无测试覆盖路径的生产代码单元列表；无结果时返回空列表
     */
    List<CodeUnit> findTestGaps(String projectId);
}

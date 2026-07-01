package com.repograph.core.graph;

import com.repograph.core.model.CodeUnit;

import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * 代码知识图谱结构查询接口，提供调用链、影响面、类型层次和入口点发现能力。
 *
 * <p>所有查询方法在目标符号不存在或无匹配结果时返回空集合，不返回 {@code null}，也不抛出异常。
 *
 * @author leolu
 * @since 0.1.0
 */
public interface GraphQueryService {

    /**
     * 查找直接或间接调用指定符号的调用方列表。
     *
     * @param qualifiedName 被调用符号的全限定名（方法用 {@code #} 分隔，如 {@code com.example.Foo#bar}）
     * @param depth         查找深度，{@code 1} 表示仅直接调用方，大于 {@code 1} 表示递归向上追溯；
     *                      {@code 0} 返回空列表
     * @return 调用方 {@link CodeUnit} 列表，按距离从近到远排序；无调用方时返回空列表，不为 {@code null}
     */
    default List<CodeUnit> findCallers(String qualifiedName, int depth) {
        return findCallers(qualifiedName, depth, null);
    }

    /**
     * 查找指定项目内直接或间接调用目标符号的调用方。
     *
     * @param qualifiedName 被调用符号全限定名
     * @param depth         查找深度
     * @param projectId     可选项目 ID；为空时查询所有项目
     * @return 调用方列表
     */
    List<CodeUnit> findCallers(String qualifiedName, int depth, String projectId);

    /**
     * 分析指定符号变更后的影响范围，返回所有可能受影响的代码单元集合。
     *
     * <p>影响范围包括直接调用方、子类实现、字段类型绑定方等传递依赖。
     *
     * @param qualifiedName 发生变更的符号全限定名
     * @return 受影响的 {@link CodeUnit} 集合；无影响时返回空集合，不为 {@code null}
     */
    default Set<CodeUnit> impactAnalysis(String qualifiedName) {
        return impactAnalysis(qualifiedName, null);
    }

    /**
     * 分析指定项目内符号变更后的影响范围。
     *
     * @param qualifiedName 目标符号全限定名
     * @param projectId     可选项目 ID；为空时查询所有项目
     * @return 受影响代码单元集合
     */
    Set<CodeUnit> impactAnalysis(String qualifiedName, String projectId);

    /**
     * 查找指定符号直接或间接调用的所有被调用方（出边方向）。
     *
     * @param qualifiedName 发起调用的符号全限定名
     * @param depth         遍历深度，{@code 1} 仅直接调用，{@code 0} 返回空列表
     * @return 被调用方 {@link CodeUnit} 列表；无调用时返回空列表，不为 {@code null}
     */
    default List<CodeUnit> findCallees(String qualifiedName, int depth) {
        return findCallees(qualifiedName, depth, null);
    }

    /**
     * 查找指定项目内目标符号直接或间接调用的代码单元。
     *
     * @param qualifiedName 发起调用的符号全限定名
     * @param depth         遍历深度
     * @param projectId     可选项目 ID；为空时查询所有项目
     * @return 被调用方列表
     */
    List<CodeUnit> findCallees(String qualifiedName, int depth, String projectId);

    /**
     * 查找指定类或接口的所有直接子类型（子类和实现类）。
     *
     * @param qualifiedName 父类或接口的全限定名
     * @return 子类型 {@link CodeUnit} 列表；无子类型时返回空列表，不为 {@code null}
     */
    default List<CodeUnit> findSubTypes(String qualifiedName) {
        return findSubTypes(qualifiedName, null);
    }

    /**
     * 查找指定项目内目标类型的直接子类型。
     *
     * @param qualifiedName 父类或接口全限定名
     * @param projectId     可选项目 ID；为空时查询所有项目
     * @return 子类型列表
     */
    List<CodeUnit> findSubTypes(String qualifiedName, String projectId);

    /**
     * 按部分名称查找可用于图查询的完整符号候选。
     *
     * @param query     qualifiedName 或 simpleName 的部分文本
     * @param projectId 可选项目 ID；为空时查询所有项目
     * @param limit     最大返回数量
     * @return 按匹配质量排序的符号候选
     */
    List<CodeUnit> findSymbols(String query, String projectId, int limit);

    /**
     * 按 qualifiedName 与项目精确查找代码单元。
     *
     * @param qualifiedName 完整符号名
     * @param projectId     可选项目 ID
     * @return 唯一匹配的代码单元
     */
    Optional<CodeUnit> findSymbol(String qualifiedName, String projectId);

    /**
     * 查找指定项目中所有被标记为入口点的代码单元（{@code metadata["is_entry_point"]="true"}）。
     *
     * @param projectId 项目唯一标识符，由 {@link com.repograph.core.util.ProjectIdUtil} 生成
     * @return 入口点 {@link CodeUnit} 列表；无入口点时返回空列表，不为 {@code null}
     */
    List<CodeUnit> findEntryPoints(String projectId);

    /**
     * 列出图中所有已注册的项目（基于 {@code :Project} 元数据节点）。
     *
     * <p>调用方通常用此结果填充 dashboard 项目选择器或 CLI {@code --project} 候选列表。
     * 已索引但未注册元节点的旧项目不在返回结果中。
     *
     * @return 项目元信息列表，按 projectId 字典序排列；无项目时返回空列表，不为 {@code null}
     */
    List<ProjectInfo> listProjects();

    /**
     * 计算指定项目的图谱聚合统计，供 dashboard 概览面板使用。
     *
     * <p>所有计数均通过 Cypher 在数据库内聚合。项目不存在或为空时返回零计数 + 空 Map 的
     * {@link ProjectStats}，不抛异常。
     *
     * @param projectId 项目唯一标识符，不为 {@code null} 或空字符串
     * @return 项目统计快照；项目不存在时仍返回带 projectId 的零计数实例
     */
    ProjectStats projectStats(String projectId);
}

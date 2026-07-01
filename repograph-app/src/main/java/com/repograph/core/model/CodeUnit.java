package com.repograph.core.model;

import java.util.List;
import java.util.Map;

/**
 * 表示一个代码符号单元，包含语法边界、元数据和原始代码。
 *
 * <p>id 由 {@code SHA256(filePath + kind + qualifiedName)} 计算，全局唯一。
 * filePath 存储相对于 projectRoot 的路径，统一使用 {@code /} 分隔符（跨平台一致）。
 *
 * @param id                 唯一标识符，{@code SHA256(filePath + kind + qualifiedName)} 的十六进制表示
 * @param kind               符号类型，见 {@link CodeUnitKind}
 * @param language           源语言，取值为 {@code "java"}、{@code "c"} 或 {@code "python"}
 * @param qualifiedName      全限定名；Java 方法用 {@code #} 分隔，如 {@code com.example.Foo#bar(String)}
 * @param simpleName         简单名称，不含包名和类名前缀
 * @param filePath           相对于 projectRoot 的文件路径，使用 {@code /} 分隔符
 * @param startLine          起始行号，1-based
 * @param endLine            结束行号，1-based
 * @param rawSource          完整原始代码，含注释和空白
 * @param signature          仅签名行，用于语义 embedding 和展示
 * @param annotations        注解列表，如 {@code ["@Service", "@Transactional"]}；无注解时为空列表，不为 {@code null}
 * @param parentQualifiedName 所属类的全限定名；顶层类或 C 顶层函数为 {@code null}
 * @param metadata           扩展元数据，键集合见 CLAUDE.md 中"metadata 标准 key"一节；不为 {@code null}
 * @author leolu
 * @since 0.1.0
 */
public record CodeUnit(
        String id,
        CodeUnitKind kind,
        String language,
        String qualifiedName,
        String simpleName,
        String filePath,
        int startLine,
        int endLine,
        String rawSource,
        String signature,
        List<String> annotations,
        String parentQualifiedName,
        Map<String, String> metadata
) {}

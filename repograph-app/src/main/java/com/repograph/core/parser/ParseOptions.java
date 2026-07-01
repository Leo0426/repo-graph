package com.repograph.core.parser;

import java.nio.file.Path;
import java.util.List;

/**
 * 解析器选项，控制解析策略、目标语言范围和项目上下文。
 *
 * @param strategy    解析策略，{@code null} 时等同于 {@link ParseStrategy#AUTO}
 * @param languages   需要解析的语言列表（如 {@code ["java", "c", "python"]}）；
 *                    空列表或 {@code null} 表示解析所有受支持语言
 * @param projectRoot 项目根目录路径，用于 import 解析和 filePath 相对化；
 *                    {@code null} 时禁用跨文件引用解析
 * @param projectId   12 字符 projectId 前缀；参与 CodeUnit ID 计算以隔离多项目数据；
 *                    {@code null} 时按空字符串处理（仅推荐在单元测试中省略）
 * @author leolu
 * @since 0.1.0
 */
public record ParseOptions(ParseStrategy strategy, List<String> languages, Path projectRoot, String projectId) {

    /**
     * 兼容旧调用方的构造器：projectId 为 {@code null}。
     */
    public ParseOptions(ParseStrategy strategy, List<String> languages, Path projectRoot) {
        this(strategy, languages, projectRoot, null);
    }

    /**
     * 创建默认解析选项：AUTO 策略，解析所有受支持语言，不设置 projectRoot / projectId。
     *
     * @return 默认 {@link ParseOptions} 实例
     */
    public static ParseOptions defaults() {
        return new ParseOptions(ParseStrategy.AUTO, List.of(), null, null);
    }

    /**
     * 创建带有项目根目录的解析选项，使用 AUTO 策略和所有语言。
     *
     * @param projectRoot 项目根目录，不为 {@code null}
     * @return 带 projectRoot 的 {@link ParseOptions} 实例
     */
    public static ParseOptions withProjectRoot(Path projectRoot) {
        return new ParseOptions(ParseStrategy.AUTO, List.of(), projectRoot, null);
    }
}

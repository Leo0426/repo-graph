package com.repograph.core.parser;

import java.nio.file.Path;

/**
 * 源文件解析器的统一接口，将源文件转换为 {@link ParseResult}（符号列表 + 关系边列表）。
 *
 * <p>每种语言的精确解析器和启发式解析器均实现此接口；
 * {@link com.repograph.parser.ParserDispatcher} 根据文件语言和策略选择具体实现。
 *
 * @author leolu
 * @since 0.1.0
 */
public interface CodeParser {

    /**
     * 解析指定源文件，提取其中所有可识别的代码符号和关系边。
     *
     * <p>解析失败（语法错误）应记录 WARN 日志并返回部分结果或空结果，
     * 而非抛出异常；仅文件不可读时抛出 {@link ParseException}。
     *
     * @param file    待解析的源文件路径，必须存在且可读
     * @param options 解析选项，{@code null} 时使用 {@link ParseOptions#defaults()}
     * @return 解析结果，包含符号列表和关系边列表；无可识别内容时返回 {@link ParseResult#empty()}，
     *         不返回 {@code null}
     * @throws ParseException 文件不可读或编码不支持时抛出
     */
    ParseResult parse(Path file, ParseOptions options);

    /**
     * 判断此解析器是否支持给定语言。
     *
     * @param language 语言标识符，如 {@code "java"}、{@code "c"}、{@code "python"}
     * @return {@code true} 表示支持，{@code false} 表示不支持
     */
    boolean supports(String language);
}

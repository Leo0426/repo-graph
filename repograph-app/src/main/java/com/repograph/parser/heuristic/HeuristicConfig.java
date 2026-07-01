package com.repograph.parser.heuristic;

import com.repograph.core.model.CodeUnitKind;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 启发式解析器的数据驱动配置，描述各语言的符号匹配规则。
 *
 * <p>每种语言对应一组 {@link UnitPattern}，解析器按配置逐一匹配，
 * 不在解析器主逻辑中硬编码任何语言特定行为。
 *
 * @param patterns 该语言的所有符号匹配规则列表，不为 {@code null}
 * @author leolu
 * @since 0.1.0
 */
public record HeuristicConfig(List<UnitPattern> patterns) {

    /**
     * 单个符号类型的匹配规则。
     *
     * @param language       适用的语言标识符，如 {@code "java"}、{@code "c"}、{@code "python"}
     * @param signatureRegex 匹配符号签名行的正则表达式；第一个捕获组必须为符号简单名称
     * @param kind           匹配到的符号对应的 {@link CodeUnitKind}
     * @param useBraces      {@code true} 表示使用大括号计数法确定 BODY 结束（Java/C）；
     *                       {@code false} 表示使用缩进层级（Python）
     */
    public record UnitPattern(
            String language,
            Pattern signatureRegex,
            CodeUnitKind kind,
            boolean useBraces
    ) {}
}

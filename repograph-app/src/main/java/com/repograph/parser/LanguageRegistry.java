package com.repograph.parser;

import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;

/**
 * 扩展名 → 语言标识符的单一事实源。
 *
 * <p>此前 SourceFileScanner、ParserDispatcher 和 HeuristicCodeParser 各自维护一份
 * 映射，导致新增语言时容易漏改且已出现漂移（如 .cpp 扩展名被静默跳过）。
 * 所有语言路由必须经由本类，禁止在调用方复制映射表。
 *
 * <p>语言标识符同时是 Qdrant payload 的 {@code language} 过滤值和
 * {@link com.repograph.core.model.CodeUnit#language()} 字段值，新增语言前先核对
 * 向量过滤与流分析服务的支持情况。
 *
 * @author leolu
 * @since 0.6.0
 */
public final class LanguageRegistry {

    /**
     * 全量扩展名映射。注意：{@code class}（字节码）与 {@code doc}（Markdown 文档）
     * 是否参与扫描由调用方的策略决定（SourceFileScanner 默认排除），本表不做区分。
     */
    public static final Map<String, String> EXTENSION_TO_LANGUAGE = Map.ofEntries(
            Map.entry("java", "java"),
            // C 及 C++ 兼容头文件；C++ 源文件目前仅启发式解析（见 HeuristicCodeParser）
            Map.entry("c", "c"),
            Map.entry("h", "c"),
            Map.entry("cpp", "cpp"),
            Map.entry("cc", "cpp"),
            Map.entry("cxx", "cpp"),
            Map.entry("hpp", "cpp"),
            Map.entry("hh", "cpp"),
            Map.entry("hxx", "cpp"),
            Map.entry("py", "python"),
            Map.entry("js", "javascript"),
            Map.entry("jsx", "javascript"),
            Map.entry("mjs", "javascript"),
            Map.entry("cjs", "javascript"),
            Map.entry("ts", "typescript"),
            Map.entry("tsx", "typescript"),
            Map.entry("mts", "typescript"),
            Map.entry("cts", "typescript"),
            // Java 字节码 — 路由到 JavaBytecodeParser，默认扫描流程不启用
            Map.entry("class", "class"),
            Map.entry("md", "doc"),
            Map.entry("markdown", "doc")
    );

    private LanguageRegistry() {
    }

    /**
     * 根据文件名推断语言标识符。
     *
     * @param fileName 文件名（含扩展名），不为 {@code null}
     * @return 语言标识符（如 {@code "java"}）；无法识别时返回 {@code null}
     */
    public static String languageOf(String fileName) {
        int dot = fileName.lastIndexOf('.');
        if (dot < 0) {
            return null;
        }
        return EXTENSION_TO_LANGUAGE.get(fileName.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    /**
     * 便捷重载：直接接受文件路径。
     *
     * @param file 源文件路径，不为 {@code null}
     * @return 语言标识符；无法识别时返回 {@code null}
     */
    public static String languageOf(Path file) {
        return languageOf(file.getFileName().toString());
    }
}

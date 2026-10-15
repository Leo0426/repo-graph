package com.repograph.parser.treesitter;

import java.nio.file.Path;
import org.springframework.stereotype.Component;
import org.treesitter.TSLanguage;
import org.treesitter.TreeSitterJavascript;

/**
 * 基于 Tree-sitter 的 JavaScript 精确解析器。
 *
 * <p>支持 {@code .js / .jsx / .mjs / .cjs} 扩展名（路由见 LanguageRegistry）。
 * 遍历与符号映射逻辑共享于 {@link AbstractJsFamilyCodeParser}。
 *
 * @author leolu
 * @since 0.6.0
 */
@Component
public class JavaScriptCodeParser extends AbstractJsFamilyCodeParser {

    private static final TreeSitterJavascript GRAMMAR = new TreeSitterJavascript();

    public JavaScriptCodeParser() {
        super("javascript");
    }

    @Override
    protected TSLanguage grammarFor(Path file) {
        return GRAMMAR;
    }
}

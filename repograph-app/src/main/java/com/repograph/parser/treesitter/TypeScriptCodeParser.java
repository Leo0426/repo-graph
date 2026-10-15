package com.repograph.parser.treesitter;

import java.nio.file.Path;
import java.util.Locale;
import org.springframework.stereotype.Component;
import org.treesitter.TSLanguage;
import org.treesitter.TreeSitterTypescript;
import org.treesitter.TreeSitterTsx;

/**
 * 基于 Tree-sitter 的 TypeScript 精确解析器。
 *
 * <p>支持 {@code .ts / .tsx / .mts / .cts} 扩展名（路由见 LanguageRegistry）；
 * {@code .tsx} 使用 TSX 语法实例，其余使用 TypeScript 语法实例。
 * 遍历与符号映射逻辑共享于 {@link AbstractJsFamilyCodeParser}。
 *
 * @author leolu
 * @since 0.6.0
 */
@Component
public class TypeScriptCodeParser extends AbstractJsFamilyCodeParser {

    private static final TreeSitterTypescript TS_GRAMMAR = new TreeSitterTypescript();
    private static final TreeSitterTsx TSX_GRAMMAR = new TreeSitterTsx();

    public TypeScriptCodeParser() {
        super("typescript");
    }

    @Override
    protected TSLanguage grammarFor(Path file) {
        if (file != null) {
            String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
            if (name.endsWith(".tsx")) {
                return TSX_GRAMMAR;
            }
        }
        return TS_GRAMMAR;
    }
}

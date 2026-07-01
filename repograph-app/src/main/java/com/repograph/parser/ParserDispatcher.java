package com.repograph.parser;

import com.repograph.core.parser.CodeParser;
import com.repograph.core.parser.ParseException;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.parser.ParseStrategy;
import com.repograph.parser.heuristic.HeuristicCodeParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

/**
 * 解析器分发器，根据文件语言和解析策略将解析请求路由至正确的实现，
 * 并在精确解析失败时自动降级为启发式解析器。
 *
 * <p>Spring 自动注入所有 {@link CodeParser} 实现；分发器按语言和策略选择候选解析器。
 * AUTO 策略下优先调用精确解析器（非 {@link HeuristicCodeParser}），
 * 结果为空或抛异常时降级至启发式解析器并记录 WARN 日志。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class ParserDispatcher {

    private static final Logger log = LoggerFactory.getLogger(ParserDispatcher.class);

    private static final Map<String, String> EXTENSION_TO_LANGUAGE = Map.of(
            "java", "java",
            "c", "c",
            "h", "c",
            "py", "python",
            "class", "class",   // 字节码 — 路由到 JavaBytecodeParser
            "md", "doc",
            "markdown", "doc"
    );

    private final List<CodeParser> parsers;

    /**
     * 通过构造器注入所有可用的 {@link CodeParser} 实现。
     *
     * @param parsers Spring 容器中所有 {@link CodeParser} bean 的列表，不为 {@code null}
     */
    public ParserDispatcher(List<CodeParser> parsers) {
        this.parsers = parsers;
    }

    /**
     * 将解析请求分发至合适的解析器，并在 AUTO 策略下执行降级逻辑。
     *
     * @param file    待解析的源文件路径，必须存在且可读
     * @param options 解析选项，{@code null} 时使用 {@link ParseOptions#defaults()}
     * @return 解析结果；所有解析器均失败时返回 {@link ParseResult#empty()}，不为 {@code null}
     */
    public ParseResult dispatch(Path file, ParseOptions options) {
        ParseOptions effectiveOptions = options != null ? options : ParseOptions.defaults();
        String language = detectLanguage(file);
        if (language == null) {
            log.debug("Skipping unsupported file: {}", file);
            return ParseResult.empty();
        }

        ParseStrategy strategy = effectiveOptions.strategy() != null
                ? effectiveOptions.strategy()
                : ParseStrategy.AUTO;

        List<CodeParser> allCandidates = parsers.stream()
                .filter(p -> p.supports(language))
                .toList();

        if (allCandidates.isEmpty()) {
            log.warn("No parser available for language '{}', file: {}", language, file);
            return ParseResult.empty();
        }

        return switch (strategy) {
            case PRECISE -> runFirst(preciseParsers(allCandidates), file, effectiveOptions);
            case HEURISTIC -> runFirst(heuristicParsers(allCandidates), file, effectiveOptions);
            case AUTO -> runWithFallback(allCandidates, file, effectiveOptions);
        };
    }

    /**
     * AUTO 策略：先用精确解析器，失败或结果为空时降级为启发式解析器。
     */
    private ParseResult runWithFallback(List<CodeParser> candidates, Path file, ParseOptions options) {
        List<CodeParser> precise = preciseParsers(candidates);
        for (CodeParser parser : precise) {
            try {
                ParseResult result = parser.parse(file, options);
                if (!result.units().isEmpty() || !result.edges().isEmpty()) {
                    return result;
                }
                log.debug("Precise parser {} returned empty result for {}, trying fallback",
                        parser.getClass().getSimpleName(), file);
            } catch (ParseException e) {
                log.warn("Precise parser {} failed for {}: {}, falling back to heuristic",
                        parser.getClass().getSimpleName(), file, e.getMessage());
            } catch (Exception e) {
                log.warn("Precise parser {} threw unexpected error for {}: {}, falling back to heuristic",
                        parser.getClass().getSimpleName(), file, e.getMessage());
            }
        }

        // Fallback to heuristic
        List<CodeParser> heuristic = heuristicParsers(candidates);
        if (!heuristic.isEmpty()) {
            log.warn("Precise parser produced no result for {}, degrading to heuristic", file);
            ParseResult fallback = runFirst(heuristic, file, options);
            return fallback.withDegraded();
        }

        log.warn("No parser succeeded for {}", file);
        return ParseResult.empty();
    }

    /**
     * 按顺序尝试列表中的解析器，返回第一个成功的结果。
     */
    private ParseResult runFirst(List<CodeParser> parsers, Path file, ParseOptions options) {
        for (CodeParser parser : parsers) {
            try {
                return parser.parse(file, options);
            } catch (ParseException e) {
                log.warn("{} failed for {}: {}", parser.getClass().getSimpleName(), file, e.getMessage());
            } catch (Exception e) {
                log.warn("{} threw unexpected error for {}: {}",
                        parser.getClass().getSimpleName(), file, e.getMessage());
            }
        }
        return ParseResult.empty();
    }

    private List<CodeParser> preciseParsers(List<CodeParser> candidates) {
        return candidates.stream()
                .filter(p -> !(p instanceof HeuristicCodeParser))
                .toList();
    }

    private List<CodeParser> heuristicParsers(List<CodeParser> candidates) {
        return candidates.stream()
                .filter(p -> p instanceof HeuristicCodeParser)
                .toList();
    }

    /**
     * 根据文件扩展名推断语言标识符。
     *
     * @param file 源文件路径，不为 {@code null}
     * @return 语言标识符（如 {@code "java"}），不支持的扩展名返回 {@code null}
     */
    private String detectLanguage(Path file) {
        String fileName = file.getFileName().toString();
        int dotIdx = fileName.lastIndexOf('.');
        if (dotIdx < 0) {
            return null;
        }
        return EXTENSION_TO_LANGUAGE.get(fileName.substring(dotIdx + 1).toLowerCase());
    }
}

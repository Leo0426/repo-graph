package com.repograph.parser.heuristic;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.parser.CodeParser;
import com.repograph.core.parser.ParseException;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.util.CodeUnitIdUtil;
import com.repograph.core.util.PathUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 基于状态机的启发式代码解析器，作为精确解析失败时的降级兜底。
 *
 * <p>状态机流转：{@code IDLE → IN_SIGNATURE → IN_BODY → COMPLETE}。
 * Java/C 使用大括号计数法退出 BODY；Python 使用缩进层级退出。
 * 启发式解析器只产出 {@link CodeUnit} 列表，不产出 {@link com.repograph.core.model.RelationEdge}。
 *
 * <p>语言逻辑由 {@link HeuristicConfig} 数据驱动，不在解析器中硬编码。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class HeuristicCodeParser implements CodeParser {

    private static final Logger log = LoggerFactory.getLogger(HeuristicCodeParser.class);

    /** 支持的语言及对应配置。 */
    private static final Map<String, HeuristicConfig> CONFIGS = Map.of(
            "java", buildJavaConfig(),
            "c",    buildCConfig(),
            "python", buildPythonConfig()
    );

    @Override
    public boolean supports(String language) {
        return CONFIGS.containsKey(language);
    }

    @Override
    public ParseResult parse(Path file, ParseOptions options) throws ParseException {
        ParseOptions opts = options != null ? options : ParseOptions.defaults();
        String language = detectLanguage(file.getFileName().toString());
        if (language == null) {
            return ParseResult.empty();
        }
        HeuristicConfig config = CONFIGS.get(language);
        if (config == null) {
            return ParseResult.empty();
        }

        String source;
        try {
            source = Files.readString(file);
        } catch (IOException e) {
            throw new ParseException("Cannot read file: " + file, e);
        }

        String relativePath = opts.projectRoot() != null
                ? PathUtil.toRelativePath(opts.projectRoot(), file)
                : file.toString().replace('\\', '/');

        String projectId = opts.projectId() != null ? opts.projectId() : "";
        List<CodeUnit> units = parseWithStateMachine(source, relativePath, projectId, language, config);
        return ParseResult.of(units, List.of(), "HeuristicCodeParser");
    }

    private List<CodeUnit> parseWithStateMachine(String source, String relativePath, String projectId,
                                                  String language, HeuristicConfig config) {
        List<CodeUnit> result = new ArrayList<>();
        String[] lines = source.split("\n", -1);

        for (HeuristicConfig.UnitPattern pattern : config.patterns()) {
            result.addAll(extractUnits(lines, relativePath, projectId, language, pattern));
        }
        return Collections.unmodifiableList(result);
    }

    private List<CodeUnit> extractUnits(String[] lines, String relativePath, String projectId, String language,
                                         HeuristicConfig.UnitPattern pattern) {
        List<CodeUnit> result = new ArrayList<>();
        State state = State.IDLE;
        int signatureStart = 0;
        StringBuilder signatureBuilder = new StringBuilder();
        StringBuilder bodyBuilder = new StringBuilder();
        int braceDepth = 0;
        int baseIndent = -1; // for Python

        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.trim();

            switch (state) {
                case IDLE -> {
                    Matcher m = pattern.signatureRegex().matcher(trimmed);
                    if (m.find()) {
                        signatureStart = i + 1; // 1-based
                        signatureBuilder.setLength(0);
                        signatureBuilder.append(trimmed);
                        bodyBuilder.setLength(0);
                        braceDepth = 0;
                        baseIndent = -1;

                        if (pattern.useBraces()) {
                            // 统计签名行中的开括号数量
                            braceDepth += countChar(trimmed, '{') - countChar(trimmed, '}');
                            if (braceDepth > 0) {
                                state = State.IN_BODY;
                            } else if (trimmed.endsWith("{")) {
                                braceDepth = 1;
                                state = State.IN_BODY;
                            } else {
                                state = State.IN_SIGNATURE;
                            }
                        } else {
                            // Python：冒号行之后开始函数体
                            if (trimmed.endsWith(":")) {
                                state = State.IN_BODY;
                                baseIndent = indentOf(line);
                            } else {
                                state = State.IN_SIGNATURE;
                            }
                        }
                    }
                }
                case IN_SIGNATURE -> {
                    signatureBuilder.append(" ").append(trimmed);
                    if (pattern.useBraces()) {
                        braceDepth += countChar(trimmed, '{') - countChar(trimmed, '}');
                        if (braceDepth > 0 || trimmed.endsWith("{")) {
                            if (braceDepth == 0) braceDepth = 1;
                            state = State.IN_BODY;
                        }
                    } else {
                        if (trimmed.endsWith(":")) {
                            state = State.IN_BODY;
                            baseIndent = indentOf(line);
                        }
                    }
                }
                case IN_BODY -> {
                    bodyBuilder.append(line).append('\n');
                    if (pattern.useBraces()) {
                        braceDepth += countChar(trimmed, '{') - countChar(trimmed, '}');
                        if (braceDepth <= 0) {
                            state = State.COMPLETE;
                        }
                    } else {
                        // Python：返回到或低于基准缩进级别时结束
                        // （且行不为空）
                        if (!trimmed.isEmpty() && indentOf(line) <= baseIndent) {
                            state = State.COMPLETE;
                            i--; // re-process this line as potential next unit
                        }
                    }
                }
                default -> { /* COMPLETE handled below */ }
            }

            if (state == State.COMPLETE) {
                int endLine = i + 1; // 1-based
                String sig = signatureBuilder.toString().trim();
                String rawSource = sig + "\n" + bodyBuilder;
                String simpleName = extractSimpleName(sig, pattern.signatureRegex());
                String qn = relativePath + "#" + simpleName + "@L" + signatureStart;

                String id = CodeUnitIdUtil.computeId(projectId, relativePath, pattern.kind(), qn);
                Map<String, String> metadata = new LinkedHashMap<>();
                metadata.put("heuristic", "true");

                CodeUnit unit = new CodeUnit(id, pattern.kind(), language, qn, simpleName,
                        relativePath, signatureStart, endLine, rawSource, sig,
                        List.of(), null, metadata);
                result.add(unit);
                log.debug("Heuristic: extracted {} '{}' at {}:{}", pattern.kind(), simpleName,
                        relativePath, signatureStart);
                state = State.IDLE;
            }
        }
        return result;
    }

    private static String extractSimpleName(String signature, Pattern regex) {
        Matcher m = regex.matcher(signature);
        if (m.find() && m.groupCount() >= 1) {
            return m.group(1);
        }
        // 兜底：取第一个看起来像标识符的单词令牌
        String[] tokens = signature.split("\\s+");
        for (String token : tokens) {
            String clean = token.replaceAll("[^a-zA-Z0-9_]", "");
            if (!clean.isEmpty() && Character.isLetter(clean.charAt(0))) {
                String candidate = clean;
                if (!isJavaKeyword(candidate)) return candidate;
            }
        }
        return "unknown";
    }

    private static boolean isJavaKeyword(String word) {
        return switch (word) {
            case "public", "private", "protected", "static", "final", "abstract",
                 "class", "interface", "enum", "void", "return", "new", "extends",
                 "implements", "throws", "synchronized", "native", "transient",
                 "volatile", "strictfp", "default", "record" -> true;
            default -> false;
        };
    }

    private static int countChar(String s, char c) {
        int count = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == c) count++;
        }
        return count;
    }

    private static int indentOf(String line) {
        int indent = 0;
        for (char c : line.toCharArray()) {
            if (c == ' ') indent++;
            else if (c == '\t') indent += 4;
            else break;
        }
        return indent;
    }

    private static String detectLanguage(String fileName) {
        if (fileName.endsWith(".java")) return "java";
        if (fileName.endsWith(".c") || fileName.endsWith(".h")) return "c";
        if (fileName.endsWith(".py")) return "python";
        return null;
    }

    // ── 配置构建器 ────────────────────────────────────────────────────────────

    private static HeuristicConfig buildJavaConfig() {
        // 第 1 组 = 方法/类名
        Pattern classPattern = Pattern.compile(
                "(?:public|protected|private|abstract|final|static|\\s)*" +
                "(?:class|interface|enum|record)\\s+(\\w+)");
        Pattern methodPattern = Pattern.compile(
                "(?:public|protected|private|static|final|synchronized|native|abstract|\\s)+" +
                "(?:[\\w<>\\[\\],?\\s]+)\\s+(\\w+)\\s*\\(");
        return new HeuristicConfig(List.of(
                new HeuristicConfig.UnitPattern("java", classPattern, CodeUnitKind.CLASS, true),
                new HeuristicConfig.UnitPattern("java", methodPattern, CodeUnitKind.METHOD, true)
        ));
    }

    private static HeuristicConfig buildCConfig() {
        Pattern funcPattern = Pattern.compile(
                "^[\\w\\s\\*]+\\s+(\\w+)\\s*\\([^;]*\\)\\s*\\{?$");
        Pattern structPattern = Pattern.compile(
                "^(?:typedef\\s+)?struct\\s+(\\w*)");
        return new HeuristicConfig(List.of(
                new HeuristicConfig.UnitPattern("c", funcPattern, CodeUnitKind.FUNCTION, true),
                new HeuristicConfig.UnitPattern("c", structPattern, CodeUnitKind.STRUCT, true)
        ));
    }

    private static HeuristicConfig buildPythonConfig() {
        Pattern classPattern = Pattern.compile("^class\\s+(\\w+)");
        Pattern funcPattern = Pattern.compile("^(?:async\\s+)?def\\s+(\\w+)\\s*\\(");
        return new HeuristicConfig(List.of(
                new HeuristicConfig.UnitPattern("python", classPattern, CodeUnitKind.CLASS, false),
                new HeuristicConfig.UnitPattern("python", funcPattern, CodeUnitKind.METHOD, false)
        ));
    }

    private enum State { IDLE, IN_SIGNATURE, IN_BODY, COMPLETE }
}

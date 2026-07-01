package com.repograph.parser.doc;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.parser.CodeParser;
import com.repograph.core.parser.ParseException;
import com.repograph.core.parser.ParseOptions;
import com.repograph.core.parser.ParseResult;
import com.repograph.core.util.CodeUnitIdUtil;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Markdown 文档解析器，将 .md / .markdown 文件按标题（H1-H3）切割为若干
 * {@link CodeUnitKind#DOCUMENT} 单元，使文档内容可被语义检索。
 *
 * <p>切分规则：
 * <ul>
 *   <li>以 {@code # }、{@code ## }、{@code ### } 开头的行作为节边界。</li>
 *   <li>首个标题前若有内容，作为"导言"节（simpleName 取文件名）。</li>
 *   <li>无任何标题时，整个文件作为一个单元。</li>
 *   <li>同名标题追加行号后缀以保证 qualifiedName 唯一。</li>
 * </ul>
 *
 * @author leolu
 * @since 0.7.0
 */
@Component
public class MarkdownDocParser implements CodeParser {

    @Override
    public boolean supports(String language) {
        return "doc".equals(language);
    }

    @Override
    public ParseResult parse(Path file, ParseOptions options) throws ParseException {
        List<String> lines;
        try {
            lines = Files.readAllLines(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new ParseException("无法读取文件：" + file, e);
        }

        Path projectRoot = options != null ? options.projectRoot() : null;
        String relPath = projectRoot != null
                ? projectRoot.relativize(file).toString().replace('\\', '/')
                : file.getFileName().toString();
        String projectId = options != null ? options.projectId() : null;
        String baseName = file.getFileName().toString().replaceFirst("\\.[^.]+$", "");

        List<RawSection> rawSections = split(lines, baseName);
        List<String> seenQn = new ArrayList<>();
        List<CodeUnit> units = new ArrayList<>();

        for (RawSection s : rawSections) {
            // 对重名标题追加行号后缀保证唯一
            String qn = relPath + "#" + s.heading;
            if (seenQn.contains(qn)) qn = qn + "-L" + s.startLine;
            seenQn.add(qn);

            String id = CodeUnitIdUtil.computeId(projectId, relPath, CodeUnitKind.DOCUMENT, qn);
            units.add(new CodeUnit(
                    id,
                    CodeUnitKind.DOCUMENT,
                    "doc",
                    qn,
                    s.heading,
                    relPath,
                    s.startLine,
                    s.endLine,
                    s.content,
                    s.signatureLine,
                    List.of(),
                    null,
                    Map.of("docFile", baseName)
            ));
        }

        return ParseResult.of(units, List.of(), "MarkdownDocParser");
    }

    /** 按 H1-H3 标题切分为节列表。 */
    private static List<RawSection> split(List<String> lines, String baseName) {
        List<Integer> headingIdx = new ArrayList<>();
        for (int i = 0; i < lines.size(); i++) {
            if (lines.get(i).matches("^#{1,3} .+")) headingIdx.add(i);
        }

        List<RawSection> sections = new ArrayList<>();

        if (headingIdx.isEmpty()) {
            // 无标题：整个文件作为一个单元
            String content = String.join("\n", lines).trim();
            if (!content.isEmpty()) {
                sections.add(new RawSection(baseName, baseName, 1, lines.size(), content));
            }
            return sections;
        }

        // 首个标题前的导言
        if (headingIdx.get(0) > 0) {
            String preamble = String.join("\n", lines.subList(0, headingIdx.get(0))).trim();
            if (!preamble.isEmpty()) {
                sections.add(new RawSection(baseName, baseName, 1, headingIdx.get(0), preamble));
            }
        }

        // 每个标题节
        for (int i = 0; i < headingIdx.size(); i++) {
            int from = headingIdx.get(i);
            int to = (i + 1 < headingIdx.size()) ? headingIdx.get(i + 1) - 1 : lines.size() - 1;

            String headingLine = lines.get(from);
            String heading = headingLine.replaceFirst("^#+\\s+", "").trim();
            String content = String.join("\n", lines.subList(from, to + 1)).trim();

            if (!content.isEmpty()) {
                sections.add(new RawSection(heading, headingLine, from + 1, to + 1, content));
            }
        }

        return sections;
    }

    private record RawSection(String heading, String signatureLine,
                               int startLine, int endLine, String content) {}
}

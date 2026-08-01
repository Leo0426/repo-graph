package com.repograph.finding;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link ReportPdfRenderer} 的行为测试：从报告 Markdown 渲染出内嵌中文字体的 PDF，
 * 且不丢失证据编号与长路径。
 *
 * @author leolu
 */
class ReportPdfRendererTest {

    private final ReportPdfRenderer renderer = new ReportPdfRenderer();

    @Test
    void rendersMarkdownToPdfWithCjkAndCitations() throws Exception {
        String markdown = """
                # 报告快照 `snap-1`

                ## 研判结论

                该报警大概率是真实风险，存在命令注入且有调用方可达。

                ### 证据

                - [C1] `com.demo.CommandRunner#exec` （`src/main/java/com/demo/CommandRunner.java:42-58`）
                - [C2] `com.demo.HttpEntry#handle`（`src/main/java/com/demo/HttpEntry.java:10-20`）

                ### 修复建议

                使用参数化命令执行，避免拼接不可信输入。
                """;

        byte[] pdf = renderer.render(markdown);

        // PDF 魔数
        assertThat(new String(pdf, 0, 5, StandardCharsets.US_ASCII)).isEqualTo("%PDF-");
        assertThat(pdf.length).isGreaterThan(1000);

        try (PDDocument document = PDDocument.load(pdf)) {
            String text = new PDFTextStripper().getText(document);
            // 中文正文不因字体缺失丢字
            assertThat(text).contains("研判结论");
            assertThat(text).contains("命令注入");
            // 证据编号完整保留
            assertThat(text).contains("C1").contains("C2");
            // 长路径出现（可能因换行被拆，断言其可定位片段）
            assertThat(text).contains("CommandRunner");
        }
    }

    @Test
    void rendersEmptyReportBodyWithoutError() throws Exception {
        byte[] pdf = renderer.render("# 报告快照 `empty`\n\n本次未发现可研判的报警。\n");

        assertThat(new String(pdf, 0, 5, StandardCharsets.US_ASCII)).isEqualTo("%PDF-");
        try (PDDocument document = PDDocument.load(pdf)) {
            assertThat(new PDFTextStripper().getText(document)).contains("未发现");
        }
    }
}

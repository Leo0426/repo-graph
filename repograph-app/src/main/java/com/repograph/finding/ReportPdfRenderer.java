package com.repograph.finding;

import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import com.vladsch.flexmark.html.HtmlRenderer;
import com.vladsch.flexmark.parser.Parser;
import com.vladsch.flexmark.util.data.MutableDataSet;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;

/**
 * 将报告 Markdown 渲染为 PDF。管道为 Markdown →（flexmark）HTML →（openhtmltopdf on PDFBox）PDF，
 * 与 Markdown 导出同源于同一份文本，保证 finding 数、结论与 citation 一致。
 *
 * <p>CJK 字体（Noto Sans SC）随 jar 打包并在 PDF 中内嵌，保证在缺少系统中文字体的容器/CI 环境下
 * 仍确定性渲染，不出现丢字或乱码。代码块与长路径通过 {@code pre-wrap} + {@code word-break} 强制换行，
 * 不丢失证据编号。
 *
 * @author leolu
 */
@Service
public class ReportPdfRenderer {

    private static final String FONT_RESOURCE = "/fonts/NotoSansSC-Regular.ttf";
    private static final String FONT_FAMILY = "Noto Sans SC";

    private final Parser markdownParser;
    private final HtmlRenderer htmlRenderer;

    /**
     * 构建渲染器，初始化可复用的 flexmark 解析器与 HTML 渲染器。
     */
    public ReportPdfRenderer() {
        MutableDataSet options = new MutableDataSet();
        this.markdownParser = Parser.builder(options).build();
        this.htmlRenderer = HtmlRenderer.builder(options).build();
    }

    /**
     * 将报告 Markdown 渲染为 PDF 字节。
     *
     * @param reportMarkdown 报告 Markdown 文本；{@code null} 按空文档处理
     * @return PDF 字节
     */
    public byte[] render(String reportMarkdown) {
        String source = reportMarkdown == null ? "" : reportMarkdown;
        String bodyHtml = htmlRenderer.render(markdownParser.parse(source));
        String xhtml = wrap(bodyHtml);
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();
            builder.useFont(this::openFont, FONT_FAMILY);
            builder.withHtmlContent(xhtml, null);
            builder.toStream(out);
            builder.run();
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException("Failed to render report PDF", e);
        }
    }

    private InputStream openFont() {
        InputStream in = getClass().getResourceAsStream(FONT_RESOURCE);
        if (in == null) {
            throw new IllegalStateException("Bundled CJK font not found on classpath: " + FONT_RESOURCE);
        }
        return in;
    }

    private static String wrap(String bodyHtml) {
        return """
                <?xml version="1.0" encoding="UTF-8"?>
                <html xmlns="http://www.w3.org/1999/xhtml">
                <head>
                <meta charset="utf-8"/>
                <style>
                  @page { size: A4; margin: 2cm 1.8cm; }
                  html { font-family: 'Noto Sans SC', sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; }
                  h1 { font-size: 18pt; } h2 { font-size: 15pt; } h3 { font-size: 13pt; }
                  h1, h2, h3 { page-break-after: avoid; }
                  code, pre { font-family: 'Noto Sans SC', monospace; background-color: #f2f2f2; }
                  pre { white-space: pre-wrap; word-break: break-all; padding: 6px; }
                  code { word-break: break-all; }
                  blockquote { border-left: 3px solid #cccccc; margin-left: 0; padding-left: 10px; color: #555555; }
                  ul { margin: 4px 0; }
                  details { display: block; margin: 8px 0; }
                  summary { display: block; font-weight: bold; margin-bottom: 4px; }
                </style>
                </head>
                <body>
                %s
                </body>
                </html>
                """.formatted(bodyHtml);
    }
}

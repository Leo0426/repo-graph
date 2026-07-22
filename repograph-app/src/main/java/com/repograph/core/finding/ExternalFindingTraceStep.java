package com.repograph.core.finding;

/**
 * 外部 SAST 报警中的一条路径或证据步骤。
 *
 * <p>该模型用于承载 SARIF codeFlow、Semgrep dataflow trace、CodeQL path 等工具输出。
 *
 * @param filePath  项目内相对文件路径；外部工具只给绝对路径时由导入器负责归一化
 * @param startLine 起始行号，1-based；未知时可为 0
 * @param endLine   结束行号，1-based；未知时可为 0
 * @param kind      步骤类型，如 {@code source}、{@code sink}、{@code call}、{@code note}
 * @param symbol    可选符号名或函数名
 * @param message   工具给出的步骤说明
 * @author leolu
 */
public record ExternalFindingTraceStep(
        String filePath,
        int startLine,
        int endLine,
        String kind,
        String symbol,
        String message
) {
    /**
     * 创建路径步骤并归一化可空字符串。
     */
    public ExternalFindingTraceStep {
        filePath = filePath == null ? "" : filePath;
        kind = kind == null ? "" : kind;
        symbol = symbol == null ? "" : symbol;
        message = message == null ? "" : message;
    }
}

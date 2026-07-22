package com.repograph.finding;

import com.repograph.core.finding.ExternalFinding;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 外部 SAST / SCA 报警导入器接口。
 *
 * @author leolu
 */
public interface ExternalFindingImporter {

    /**
     * 判断当前导入器是否支持指定格式。
     *
     * @param format 格式名称，如 {@code semgrep}、{@code sarif}
     * @return 支持返回 true
     */
    boolean supports(String format);

    /**
     * 从 JSON 文本导入外部报警。
     *
     * @param json 外部工具 JSON 输出
     * @return 归一化报警列表
     * @throws ExternalFindingImportException JSON 无效或格式不兼容
     */
    List<ExternalFinding> importJson(String json);

    /**
     * 从 JSON 输入流导入外部报警。默认实现为不支持流式解析的导入器提供兼容适配。
     *
     * @param input 外部工具 JSON 输入流
     * @return 归一化报警列表
     * @throws ExternalFindingImportException JSON 无效、读取失败或格式不兼容
     */
    default List<ExternalFinding> importJson(InputStream input) {
        try {
            return importJson(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new ExternalFindingImportException("Failed to read finding JSON", e);
        }
    }

    /**
     * 从 JSON 输入流导入至多指定数量的外部报警。
     *
     * @param input       外部工具 JSON 输入流
     * @param maxFindings 最多返回的报警数，必须大于零
     * @return 不超过上限的归一化报警列表
     * @throws ExternalFindingImportException JSON 无效、读取失败或格式不兼容
     */
    default List<ExternalFinding> importJson(InputStream input, int maxFindings) {
        if (maxFindings < 1) throw new IllegalArgumentException("maxFindings must be greater than zero");
        List<ExternalFinding> findings = importJson(input);
        return findings.size() <= maxFindings ? findings : List.copyOf(findings.subList(0, maxFindings));
    }
}

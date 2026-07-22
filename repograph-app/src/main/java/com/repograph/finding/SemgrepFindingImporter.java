package com.repograph.finding;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ExternalFindingTraceStep;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Semgrep JSON 输出导入器。
 *
 * @author leolu
 */
@Component
public class SemgrepFindingImporter implements ExternalFindingImporter {

    private final ObjectMapper mapper;

    /**
     * 创建 Semgrep 导入器。
     *
     * @param mapper Jackson ObjectMapper
     */
    public SemgrepFindingImporter(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean supports(String format) {
        return format != null && "semgrep".equals(format.toLowerCase(Locale.ROOT));
    }

    @Override
    public List<ExternalFinding> importJson(String json) {
        JsonNode root;
        try {
            root = mapper.readTree(json);
        } catch (JsonProcessingException e) {
            throw new ExternalFindingImportException("Invalid Semgrep JSON", e);
        }
        JsonNode results = root.path("results");
        if (!results.isArray()) {
            throw new ExternalFindingImportException("Semgrep JSON must contain results array");
        }

        List<ExternalFinding> findings = new ArrayList<>();
        for (JsonNode result : results) {
            findings.add(toFinding(result));
        }
        return List.copyOf(findings);
    }

    private static ExternalFinding toFinding(JsonNode result) {
        String ruleId = FindingImportJson.text(result, "/check_id");
        String filePath = FindingImportJson.text(result, "/path");
        int startLine = FindingImportJson.intValue(result, "/start/line", 0);
        int endLine = FindingImportJson.intValue(result, "/end/line", startLine);
        JsonNode extra = result.path("extra");
        String severity = FindingImportJson.firstText(extra, "/severity", "/metadata/impact");
        String cwe = extractCwe(extra.path("metadata"));
        String message = FindingImportJson.firstText(extra, "/message", "/metadata/description");
        String symbol = FindingImportJson.firstText(extra, "/metadata/function", "/metadata/symbol");

        return new ExternalFinding(
                "semgrep",
                ruleId,
                cwe,
                ExternalFindingSeverity.from(severity),
                message.isBlank() ? ruleId : message,
                filePath,
                startLine,
                endLine,
                symbol,
                trace(extra.path("dataflow_trace"), filePath),
                result.toString()
        );
    }

    private static String extractCwe(JsonNode metadata) {
        String direct = FindingImportJson.firstText(metadata, "/cwe", "/cwe_id");
        String normalized = FindingImportJson.normalizeCwe(direct);
        if (!normalized.isBlank()) return normalized;
        JsonNode cwe = metadata.path("cwe");
        if (cwe.isArray()) {
            normalized = FindingImportJson.firstCweFromTags(cwe);
            if (!normalized.isBlank()) return normalized;
        }
        return FindingImportJson.firstCweFromTags(metadata.path("tags"));
    }

    private static List<ExternalFindingTraceStep> trace(JsonNode dataflowTrace, String fallbackFile) {
        if (dataflowTrace == null || dataflowTrace.isMissingNode() || dataflowTrace.isNull()) {
            return List.of();
        }
        List<ExternalFindingTraceStep> steps = new ArrayList<>();
        addLocationStep(steps, dataflowTrace.path("taint_source"), "source", fallbackFile);
        JsonNode intermediate = dataflowTrace.path("intermediate_vars");
        if (intermediate.isArray()) {
            intermediate.forEach(item -> addLocationStep(steps, item, "call", fallbackFile));
        }
        addLocationStep(steps, dataflowTrace.path("taint_sink"), "sink", fallbackFile);
        return List.copyOf(steps);
    }

    private static void addLocationStep(List<ExternalFindingTraceStep> steps, JsonNode node,
                                        String kind, String fallbackFile) {
        if (node == null || node.isMissingNode() || node.isNull()) return;
        JsonNode location = node.path("location");
        String filePath = FindingImportJson.firstText(location, "/path", "/file");
        if (filePath.isBlank()) filePath = fallbackFile;
        int line = FindingImportJson.intValue(location, "/start/line",
                FindingImportJson.intValue(location, "/line", 0));
        int endLine = FindingImportJson.intValue(location, "/end/line", line);
        String message = FindingImportJson.firstText(node, "/content", "/message");
        if (line <= 0 && message.isBlank()) return;
        steps.add(new ExternalFindingTraceStep(filePath, line, endLine, kind, "", message));
    }
}

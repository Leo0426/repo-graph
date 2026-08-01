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
 * Slither（Solidity 静态分析）JSON 输出导入器。
 *
 * <p>RepoGraph 不解析 / 不索引 Solidity，因此 Slither 报警无法关联到 RepoGraph 的 CodeUnit 或调用图。
 * 每条报警保留 Slither 自带的文件/行号（不编造定位），并附加一条 {@code context-unavailable} 标记步，
 * 明确「无 Solidity 索引、上下文不可定位」，供研判阶段不据此假装拥有调用图证据。
 *
 * @author leolu
 */
@Component
public class SlitherFindingImporter implements ExternalFindingImporter {

    /** 标记 Slither 报警在 RepoGraph 中无法定位到 CodeUnit 的 trace 步类型。 */
    public static final String CONTEXT_UNAVAILABLE_KIND = "context-unavailable";

    private static final String CONTEXT_UNAVAILABLE_NOTE =
            "RepoGraph has no Solidity index; location is from Slither and is not "
                    + "cross-referenced to a CodeUnit or call graph";

    private final ObjectMapper mapper;

    /**
     * 创建 Slither 导入器。
     *
     * @param mapper Jackson ObjectMapper
     */
    public SlitherFindingImporter(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean supports(String format) {
        return format != null && "slither".equals(format.toLowerCase(Locale.ROOT));
    }

    @Override
    public List<ExternalFinding> importJson(String json) {
        JsonNode root;
        try {
            root = mapper.readTree(json);
        } catch (JsonProcessingException e) {
            throw new ExternalFindingImportException("Invalid Slither JSON", e);
        }
        JsonNode detectors = root.path("results").path("detectors");
        if (!detectors.isArray()) {
            throw new ExternalFindingImportException(
                    "Slither JSON must contain results.detectors array");
        }

        List<ExternalFinding> findings = new ArrayList<>();
        for (JsonNode detector : detectors) {
            findings.add(toFinding(detector));
        }
        return List.copyOf(findings);
    }

    private static ExternalFinding toFinding(JsonNode detector) {
        String ruleId = FindingImportJson.text(detector, "/check");
        String impact = FindingImportJson.text(detector, "/impact");
        String description = FindingImportJson.text(detector, "/description").trim();

        JsonNode element = detector.path("elements").path(0);
        JsonNode sourceMapping = element.path("source_mapping");
        String filePath = FindingImportJson.firstText(
                sourceMapping, "/filename_relative", "/filename_short", "/filename_absolute");
        int[] range = lineRange(sourceMapping.path("lines"));
        String symbol = FindingImportJson.text(element, "/name");

        return new ExternalFinding(
                "slither",
                ruleId,
                "",
                ExternalFindingSeverity.from(impact),
                description.isBlank() ? ruleId : description,
                filePath,
                range[0],
                range[1],
                symbol,
                List.of(new ExternalFindingTraceStep(
                        filePath, range[0], range[1], CONTEXT_UNAVAILABLE_KIND, symbol,
                        CONTEXT_UNAVAILABLE_NOTE)),
                detector.toString());
    }

    private static int[] lineRange(JsonNode lines) {
        if (lines == null || !lines.isArray() || lines.isEmpty()) {
            return new int[] {0, 0};
        }
        int min = Integer.MAX_VALUE;
        int max = 0;
        for (JsonNode line : lines) {
            int value = line.asInt(0);
            if (value <= 0) {
                continue;
            }
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
        return min == Integer.MAX_VALUE ? new int[] {0, 0} : new int[] {min, max};
    }
}

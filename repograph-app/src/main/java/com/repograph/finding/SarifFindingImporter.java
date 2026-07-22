package com.repograph.finding;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.repograph.core.finding.ExternalFinding;
import com.repograph.core.finding.ExternalFindingSeverity;
import com.repograph.core.finding.ExternalFindingTraceStep;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * SARIF 2.1.0 报警导入器。CodeQL 默认输出 SARIF，因此通过此导入器支持。
 *
 * @author leolu
 */
@Component
public class SarifFindingImporter implements ExternalFindingImporter {

    private final ObjectMapper mapper;

    /**
     * 创建 SARIF 导入器。
     *
     * @param mapper Jackson ObjectMapper
     */
    public SarifFindingImporter(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean supports(String format) {
        if (format == null) return false;
        String normalized = format.toLowerCase(Locale.ROOT);
        return "sarif".equals(normalized) || "codeql".equals(normalized);
    }

    @Override
    public List<ExternalFinding> importJson(String json) {
        return importJson(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));
    }

    @Override
    public List<ExternalFinding> importJson(InputStream input) {
        return importJson(input, Integer.MAX_VALUE);
    }

    @Override
    public List<ExternalFinding> importJson(InputStream input, int maxFindings) {
        if (maxFindings < 1) throw new IllegalArgumentException("maxFindings must be greater than zero");
        List<ExternalFinding> findings = new ArrayList<>();
        boolean runsFound = false;
        try (JsonParser parser = mapper.getFactory().createParser(input)) {
            if (parser.nextToken() != JsonToken.START_OBJECT) {
                throw new ExternalFindingImportException("SARIF JSON root must be an object");
            }
            while (parser.nextToken() != JsonToken.END_OBJECT) {
                String field = parser.currentName();
                JsonToken valueToken = parser.nextToken();
                if ("runs".equals(field)) {
                    if (valueToken != JsonToken.START_ARRAY) {
                        throw new ExternalFindingImportException("SARIF JSON must contain runs array");
                    }
                    runsFound = true;
                    while (parser.nextToken() != JsonToken.END_ARRAY) {
                        parseRun(parser, findings, maxFindings);
                    }
                } else {
                    parser.skipChildren();
                }
            }
        } catch (IOException e) {
            throw new ExternalFindingImportException("Invalid SARIF JSON", e);
        }
        if (!runsFound) throw new ExternalFindingImportException("SARIF JSON must contain runs array");
        return List.copyOf(findings);
    }

    private void parseRun(JsonParser parser, List<ExternalFinding> findings, int maxFindings) throws IOException {
        if (parser.currentToken() != JsonToken.START_OBJECT) {
            throw new ExternalFindingImportException("SARIF runs entries must be objects");
        }
        String tool = "";
        Map<String, JsonNode> rules = Map.of();
        List<JsonNode> pendingResults = new ArrayList<>();
        while (parser.nextToken() != JsonToken.END_OBJECT) {
            String field = parser.currentName();
            JsonToken valueToken = parser.nextToken();
            if ("tool".equals(field)) {
                JsonNode toolNode = mapper.readTree(parser);
                tool = FindingImportJson.text(toolNode, "/driver/name");
                rules = rulesByTool(toolNode);
            } else if ("automationDetails".equals(field) && tool.isBlank()) {
                tool = FindingImportJson.text(mapper.readTree(parser), "/id");
            } else if ("results".equals(field) && valueToken == JsonToken.START_ARRAY) {
                while (parser.nextToken() != JsonToken.END_ARRAY) {
                    JsonNode result = mapper.readTree(parser);
                    if (findings.size() + pendingResults.size() >= maxFindings) continue;
                    if (tool.isBlank()) pendingResults.add(result);
                    else findings.add(toFinding(tool, result, rules.get(result.path("ruleId").asText(""))));
                }
            } else {
                parser.skipChildren();
            }
        }
        String resolvedTool = tool.isBlank() ? "sarif" : tool;
        for (JsonNode result : pendingResults) {
            if (findings.size() >= maxFindings) break;
            findings.add(toFinding(resolvedTool, result, rules.get(result.path("ruleId").asText(""))));
        }
    }

    private static Map<String, JsonNode> rulesByTool(JsonNode tool) {
        Map<String, JsonNode> rules = new HashMap<>();
        JsonNode driverRules = tool.path("driver").path("rules");
        if (driverRules.isArray()) {
            driverRules.forEach(rule -> {
                String id = rule.path("id").asText("");
                if (!id.isBlank()) rules.put(id, rule);
            });
        }
        return rules;
    }

    private static ExternalFinding toFinding(String tool, JsonNode result, JsonNode rule) {
        JsonNode location = firstLocation(result);
        JsonNode physical = location.path("physicalLocation");
        JsonNode region = physical.path("region");
        String ruleId = result.path("ruleId").asText("");
        String filePath = FindingImportJson.text(physical, "/artifactLocation/uri");
        int startLine = FindingImportJson.intValue(region, "/startLine", 0);
        int endLine = FindingImportJson.intValue(region, "/endLine", startLine);
        String message = FindingImportJson.firstText(result, "/message/text", "/message/markdown");
        String cwe = cwe(result, rule);
        String symbol = FindingImportJson.firstText(location, "/logicalLocations/0/fullyQualifiedName",
                "/logicalLocations/0/name");

        return new ExternalFinding(
                tool,
                ruleId,
                cwe,
                ExternalFindingSeverity.from(result.path("level").asText("")),
                message.isBlank() ? ruleId : message,
                filePath,
                startLine,
                endLine,
                symbol,
                trace(result),
                result.toString()
        );
    }

    private static JsonNode firstLocation(JsonNode result) {
        JsonNode locations = result.path("locations");
        return locations.isArray() && !locations.isEmpty() ? locations.get(0) : MissingNode.getInstance();
    }

    private static String cwe(JsonNode result, JsonNode rule) {
        String direct = FindingImportJson.normalizeCwe(FindingImportJson.firstText(
                result, "/properties/cwe", "/properties/cweId"));
        if (!direct.isBlank()) return direct;
        if (rule != null) {
            String fromTags = FindingImportJson.firstCweFromTags(rule.path("properties").path("tags"));
            if (!fromTags.isBlank()) return fromTags;
            return FindingImportJson.normalizeCwe(FindingImportJson.firstText(
                    rule, "/properties/cwe", "/properties/cweId"));
        }
        return "";
    }

    private static List<ExternalFindingTraceStep> trace(JsonNode result) {
        List<ExternalFindingTraceStep> steps = new ArrayList<>();
        JsonNode codeFlows = result.path("codeFlows");
        if (!codeFlows.isArray()) return List.of();
        for (JsonNode codeFlow : codeFlows) {
            for (JsonNode threadFlow : codeFlow.path("threadFlows")) {
                for (JsonNode item : threadFlow.path("locations")) {
                    JsonNode location = item.path("location");
                    JsonNode physical = location.path("physicalLocation");
                    JsonNode region = physical.path("region");
                    String filePath = FindingImportJson.text(physical, "/artifactLocation/uri");
                    int startLine = FindingImportJson.intValue(region, "/startLine", 0);
                    int endLine = FindingImportJson.intValue(region, "/endLine", startLine);
                    String message = FindingImportJson.firstText(location, "/message/text", "/message/markdown");
                    String kind = FindingImportJson.text(item, "/kinds/0");
                    String symbol = FindingImportJson.firstText(location,
                            "/logicalLocations/0/fullyQualifiedName",
                            "/logicalLocations/0/name");
                    steps.add(new ExternalFindingTraceStep(filePath, startLine, endLine, kind, symbol, message));
                }
            }
        }
        return List.copyOf(steps);
    }
}

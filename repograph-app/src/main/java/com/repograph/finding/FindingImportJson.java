package com.repograph.finding;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * 外部报警 JSON 解析辅助方法。
 *
 * @author leolu
 */
final class FindingImportJson {

    private FindingImportJson() {
    }

    static String text(JsonNode node, String pointer) {
        if (node == null) return "";
        JsonNode value = node.at(pointer);
        return value.isMissingNode() || value.isNull() ? "" : value.asText("");
    }

    static int intValue(JsonNode node, String pointer, int fallback) {
        if (node == null) return fallback;
        JsonNode value = node.at(pointer);
        return value.isMissingNode() || value.isNull() ? fallback : value.asInt(fallback);
    }

    static String firstText(JsonNode node, String... pointers) {
        for (String pointer : pointers) {
            String value = text(node, pointer);
            if (!value.isBlank()) return value;
        }
        return "";
    }

    static String firstCweFromTags(JsonNode tags) {
        if (tags == null || !tags.isArray()) return "";
        Iterator<JsonNode> it = tags.elements();
        while (it.hasNext()) {
            String value = it.next().asText("");
            String normalized = normalizeCwe(value);
            if (!normalized.isBlank()) return normalized;
        }
        return "";
    }

    static List<String> textArray(JsonNode node) {
        List<String> values = new ArrayList<>();
        if (node == null || !node.isArray()) return values;
        node.forEach(item -> {
            String value = item.asText("");
            if (!value.isBlank()) values.add(value);
        });
        return values;
    }

    static String normalizeCwe(String value) {
        if (value == null || value.isBlank()) return "";
        String upper = value.trim().toUpperCase(java.util.Locale.ROOT);
        int idx = upper.indexOf("CWE-");
        if (idx >= 0) {
            StringBuilder out = new StringBuilder("CWE-");
            for (int i = idx + 4; i < upper.length(); i++) {
                char c = upper.charAt(i);
                if (!Character.isDigit(c)) break;
                out.append(c);
            }
            return out.length() > 4 ? out.toString() : "";
        }
        if (upper.startsWith("CWE_")) {
            return "CWE-" + upper.substring(4);
        }
        return "";
    }
}

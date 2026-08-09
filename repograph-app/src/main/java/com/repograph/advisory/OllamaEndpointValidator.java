package com.repograph.advisory;

import java.net.URI;
import java.net.URISyntaxException;

/** Ollama 页面配置的集中校验器。 */
final class OllamaEndpointValidator {

    private static final int MAX_URL_LENGTH = 500;
    private static final int MAX_MODEL_LENGTH = 200;

    private OllamaEndpointValidator() {
    }

    static String normalizeBaseUrl(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Ollama base URL is required");
        }
        String candidate = value.trim();
        if (candidate.length() > MAX_URL_LENGTH) {
            throw new IllegalArgumentException("Ollama base URL is too long");
        }
        try {
            URI uri = new URI(candidate);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null) {
                throw new IllegalArgumentException("Ollama base URL must be an HTTP(S) endpoint");
            }
            if (uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
                throw new IllegalArgumentException("Ollama base URL must not contain credentials, query, or fragment");
            }
            String normalized = uri.toString();
            while (normalized.endsWith("/")) {
                normalized = normalized.substring(0, normalized.length() - 1);
            }
            return normalized;
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("Ollama base URL is invalid", e);
        }
    }

    static String normalizeModel(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Ollama model is required");
        }
        String model = value.trim();
        if (model.length() > MAX_MODEL_LENGTH) {
            throw new IllegalArgumentException("Ollama model is too long");
        }
        return model;
    }
}

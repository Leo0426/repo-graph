package com.repograph.core.modelprovider;

/** Public provider configuration, deliberately excluding credentials. @author leolu */
public record ModelProvider(String id, String name, Protocol protocol, String baseUrl, String model,
                            boolean enabled, boolean selected, boolean apiKeyConfigured,
                            int timeoutMillis, int maxOutputTokens, String updatedAt,
                            Double inputUsdPerMillionTokens, Double outputUsdPerMillionTokens) {
    /** Supported generation wire protocols, independent of a vendor's display name. */
    public enum Protocol { OLLAMA, OPENAI, OPENAI_COMPATIBLE, ANTHROPIC }
}

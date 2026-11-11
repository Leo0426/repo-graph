package com.repograph.advisory;

import com.repograph.core.advisory.LlmAdvisorySettings;
import com.repograph.core.advisory.LlmAdvisorySettingsService;
import com.repograph.core.modelprovider.ModelProvider.Protocol;
import com.repograph.modelprovider.ModelProviderStore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Compatibility view over the single authoritative generation-provider registry. @author leolu */
@Service
public class LlmAdvisorySettingsStore implements LlmAdvisorySettingsService {
    private final ModelProviderStore providers;

    /** Uses the same selected provider as every generation adapter and management endpoint. */
    @Autowired
    public LlmAdvisorySettingsStore(ModelProviderStore providers) {
        this.providers = providers;
    }

    /** Standalone initialization, preserving the former settings-store construction contract. */
    public LlmAdvisorySettingsStore(String dbPath, boolean configuredEnabled,
                                    String configuredBaseUrl, String configuredModel) {
        this(new ModelProviderStore(dbPath, "", configuredEnabled, configuredBaseUrl, configuredModel));
    }

    @Override
    public LlmAdvisorySettings current() {
        var provider = providers.current();
        return new LlmAdvisorySettings(provider.enabled(), provider.protocol().name(), provider.baseUrl(),
                provider.model(), provider.updatedAt());
    }

    @Override
    public LlmAdvisorySettings update(boolean enabled, String baseUrl, String model, String updatedAt) {
        var provider = providers.current();
        if (provider.protocol() != Protocol.OLLAMA) {
            throw new IllegalArgumentException("Manage the selected provider in model provider settings");
        }
        providers.save(provider.id(), new ModelProviderStore.ProviderInput(provider.name(), "OLLAMA", baseUrl,
                model, enabled, null, false, provider.timeoutMillis(), provider.maxOutputTokens(),
                provider.inputUsdPerMillionTokens(), provider.outputUsdPerMillionTokens()), updatedAt);
        return current();
    }
}

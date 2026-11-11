package com.repograph.wiki;

import com.repograph.core.advisory.LlmModelException;
import com.repograph.core.wiki.WikiModelException;
import com.repograph.core.wiki.WikiSummaryModel;
import com.repograph.modelprovider.GenerationGateway;
import org.springframework.stereotype.Component;

import java.util.Map;

/** Wiki text adapter using the selected generation provider; legacy class name retained. @author leolu */
@Component
public class OllamaWikiSummaryModel implements WikiSummaryModel {
    private final GenerationGateway gateway;

    /** Uses the shared provider registry and protocol transport. */
    public OllamaWikiSummaryModel(GenerationGateway gateway) { this.gateway = gateway; }

    @Override
    public boolean available() { return gateway.current().enabled(); }

    @Override
    public String model() {
        var provider = gateway.current();
        return provider.enabled() ? provider.model() : "";
    }

    @Override
    public String complete(String systemPrompt, String userPrompt) {
        try {
            return gateway.complete(systemPrompt, userPrompt, Map.of(), null).text();
        } catch (LlmModelException error) {
            throw new WikiModelException(error.getMessage());
        }
    }
}

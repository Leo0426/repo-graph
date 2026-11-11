package com.repograph.api;

import com.repograph.core.modelprovider.ModelProvider;
import com.repograph.core.identity.Account;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import com.repograph.modelprovider.ModelProviderStore;
import com.repograph.modelprovider.ModelCatalog;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/** Administrator-only provider configuration; authentication and CSRF are enforced by the security chain. @author leolu */
@RestController
@RequestMapping("/api/v1/admin/model-providers")
public class ModelProviderController {
    private final ModelProviderStore providers;
    private final com.repograph.modelprovider.GenerationGateway gateway;
    private final ModelCatalog catalog;

    /** Creates the administrator's provider endpoint. */
    public ModelProviderController(ModelProviderStore providers, com.repograph.modelprovider.GenerationGateway gateway,
                                   ModelCatalog catalog) {
        this.providers = providers;
        this.gateway = gateway;
        this.catalog = catalog;
    }

    /** Fetches a draft's model list without saving credentials or invoking generation. */
    @PostMapping("/models")
    public Map<String, List<String>> models(@RequestBody ModelProviderStore.CatalogInput input) {
        return Map.of("models", catalog.list(input));
    }

    /** Reports a safe upstream discovery error while keeping manual model entry available. */
    @ExceptionHandler(ModelCatalog.DiscoveryException.class)
    public ResponseEntity<Map<String, String>> discoveryFailed(ModelCatalog.DiscoveryException error) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", error.getMessage()));
    }

    /** Explicitly tests the saved credential and model with a small generation request. */
    @PostMapping("/{id}/test")
    public com.repograph.modelprovider.GenerationGateway.ConnectionTest test(@PathVariable String id) {
        return gateway.testConnection(id);
    }

    /** Lists profiles without credential material. */
    @GetMapping
    public List<ModelProvider> list() { return providers.list(); }

    /** Creates a provider with an optional write-only API key. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ModelProvider create(@AuthenticationPrincipal Account actor, @RequestBody ModelProviderStore.ProviderInput input) {
        return providers.save(null, input, java.time.Instant.now().toString(), actor.id());
    }

    /** Updates a provider; a blank API key retains the saved credential. */
    @PutMapping("/{id}")
    public ModelProvider update(@AuthenticationPrincipal Account actor, @PathVariable String id,
                                @RequestBody ModelProviderStore.ProviderInput input) {
        return providers.save(id, input, java.time.Instant.now().toString(), actor.id());
    }

    /** Selects an enabled profile for subsequent generation calls. */
    @PostMapping("/{id}/select")
    public ModelProvider select(@AuthenticationPrincipal Account actor, @PathVariable String id) {
        return providers.select(id, actor.id());
    }

    /** Deletes an unused profile. */
    @DeleteMapping("/{id}")
    public Map<String, Boolean> delete(@AuthenticationPrincipal Account actor, @PathVariable String id) {
        providers.delete(id, actor.id());
        return Map.of("deleted", true);
    }
}

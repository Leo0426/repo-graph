package com.repograph.api;

import com.repograph.core.modelprovider.ModelProvider;
import com.repograph.identity.ProjectAccess;
import com.repograph.modelprovider.ModelProviderStore;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Read-only capability facts for all approved accounts, without provider credentials or network probes.
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/capabilities")
@ProjectAccess(mode = ProjectAccess.Mode.AUTHENTICATED)
public class CapabilityController {
    private final ModelProviderStore providers;

    /** Creates a configuration-only view; no generation gateway is involved. */
    public CapabilityController(ModelProviderStore providers) {
        this.providers = providers;
    }

    /** Reads the selected saved configuration without claiming a connection or generation succeeded. */
    @GetMapping("/generation")
    public GenerationCapability generation() {
        return providers.list().stream().filter(ModelProvider::selected).findFirst()
                .map(provider -> new GenerationCapability(true, provider.enabled(), provider.name(), provider.model(),
                        "NOT_CHECKED", "NOT_VERIFIED"))
                .orElseGet(() -> new GenerationCapability(false, false, "", "", "NOT_CHECKED", "NOT_VERIFIED"));
    }

    /** Safe configuration facts; neither connection addresses nor credential state are disclosed. */
    public record GenerationCapability(boolean configured, boolean enabled, String name, String model,
                                       String connectionStatus, String generationStatus) {}
}

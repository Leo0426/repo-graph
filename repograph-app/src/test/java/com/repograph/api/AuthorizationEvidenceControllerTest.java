package com.repograph.api;

import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.authorization.AuthorizationEvidence;
import com.repograph.core.authorization.AuthorizationEvidenceService;
import com.repograph.core.authorization.AuthorizationEvidenceStatus;
import com.repograph.core.authorization.RouteEvidence;
import com.repograph.core.authorization.SourceCitation;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;

/**
 * 资产级鉴权证据查询 API 测试。
 *
 * @author leolu
 */
class AuthorizationEvidenceControllerTest {

    private AssetImportService assetImportService;
    private AuthorizationEvidenceService evidenceService;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        assetImportService = mock(AssetImportService.class);
        evidenceService = mock(AuthorizationEvidenceService.class);
        mvc = standaloneSetup(new AuthorizationEvidenceController(assetImportService, evidenceService))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @Test
    void readyAssetReturnsProjectEvidence() throws Exception {
        ImportedAsset asset = asset(AssetStatus.READY);
        AuthorizationEvidence evidence = new AuthorizationEvidence(
                asset.projectId(),
                new RouteEvidence(
                        "/users/{id}",
                        List.of("GET"),
                        "com.example.UserController#user(String)",
                        new SourceCitation(
                                "com.example.UserController#user(String)",
                                "src/UserController.java",
                                10,
                                15)),
                AuthorizationEvidenceStatus.NO_LOCAL_EVIDENCE,
                List.of(),
                List.of(),
                List.of("No local authorization evidence was found; this does not prove unauthenticated access"));
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset));
        when(evidenceService.analyze("project-1", 5)).thenReturn(List.of(evidence));

        mvc.perform(get("/api/v1/assets/asset-1/authorization-evidence").param("depth", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].route.path").value("/users/{id}"))
                .andExpect(jsonPath("$[0].status").value("NO_LOCAL_EVIDENCE"));

        verify(evidenceService).analyze("project-1", 5);
    }

    @Test
    void missingAssetReturnsNotFound() throws Exception {
        when(assetImportService.find("missing")).thenReturn(Optional.empty());

        mvc.perform(get("/api/v1/assets/missing/authorization-evidence"))
                .andExpect(status().isNotFound());
    }

    @Test
    void indexingAssetReturnsConflict() throws Exception {
        when(assetImportService.find("asset-1")).thenReturn(Optional.of(asset(AssetStatus.INDEXING)));

        mvc.perform(get("/api/v1/assets/asset-1/authorization-evidence"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_NOT_READY"));
    }

    private static ImportedAsset asset(AssetStatus status) {
        return new ImportedAsset(
                "asset-1",
                "project-1",
                "source.zip",
                "ZIP",
                Path.of("/managed/source"),
                status,
                null,
                "2026-01-01T00:00:00Z",
                "2026-01-01T00:00:00Z",
                null);
    }
}

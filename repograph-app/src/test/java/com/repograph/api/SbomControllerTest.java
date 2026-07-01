package com.repograph.api;

import com.repograph.sbom.SbomException;
import com.repograph.sbom.SbomService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.file.Path;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link SbomController} 单元测试，验证 CycloneDX SBOM 生成端点。
 *
 * @author leolu
 * @since 0.1.0
 */
@WebMvcTest(SbomController.class)
class SbomControllerTest {

    @Autowired
    MockMvc mvc;

    @MockBean
    SbomService sbomService;

    private static final String SAMPLE_JSON = "{\"bomFormat\":\"CycloneDX\",\"components\":[]}";

    @Test
    void sbom_success_returns200WithJson() throws Exception {
        when(sbomService.generateCycloneDx(any(Path.class))).thenReturn(SAMPLE_JSON);

        mvc.perform(get("/api/v1/sbom/proj123").param("projectRoot", "/tmp/myproject"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/json"))
                .andExpect(jsonPath("$.bomFormat").value("CycloneDX"));
    }

    @Test
    void sbom_exception_returns400() throws Exception {
        when(sbomService.generateCycloneDx(any(Path.class)))
                .thenThrow(new SbomException("pom.xml not found"));

        mvc.perform(get("/api/v1/sbom/proj123").param("projectRoot", "/tmp/no-pom"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("pom.xml not found"));
    }

    @Test
    void sbom_missingProjectRoot_returns400() throws Exception {
        mvc.perform(get("/api/v1/sbom/proj123"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void sbom_withFormatParam_stillSucceeds() throws Exception {
        when(sbomService.generateCycloneDx(any(Path.class))).thenReturn(SAMPLE_JSON);

        mvc.perform(get("/api/v1/sbom/proj123")
                        .param("projectRoot", "/tmp/myproject")
                        .param("format", "cyclonedx"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bomFormat").value("CycloneDX"));
    }
}

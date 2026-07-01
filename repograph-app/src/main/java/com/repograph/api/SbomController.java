package com.repograph.api;

import com.repograph.sbom.SbomException;
import com.repograph.sbom.SbomService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Path;

/**
 * SBOM 生成 REST API，根据项目路径生成 CycloneDX JSON 格式的软件物料清单。
 *
 * @author leolu
 * @since 0.1.0
 */
@RestController
@RequestMapping("/api/v1")
public class SbomController {

    private final SbomService sbomService;

    /**
     * 通过构造器注入 SBOM 生成服务。
     *
     * @param sbomService SBOM 生成服务，不为 {@code null}
     */
    public SbomController(SbomService sbomService) {
        this.sbomService = sbomService;
    }

    /**
     * 生成指定项目的 CycloneDX JSON SBOM。
     *
     * <p>通过 {@code projectRoot} 参数指定项目根目录，该目录必须包含 {@code pom.xml}。
     * MVP 阶段 {@code projectId} 路径变量仅用于路由，实际项目由 {@code projectRoot} 参数决定。
     *
     * @param projectId  项目唯一标识符（路径变量，用于路由）
     * @param projectRoot 项目根目录绝对路径，不为 {@code null}
     * @param format     输出格式，当前仅支持 {@code cyclonedx}（默认）
     * @return CycloneDX JSON 字符串，失败时返回 400 或 404
     */
    @GetMapping("/sbom/{projectId}")
    public ResponseEntity<String> sbom(
            @PathVariable String projectId,
            @RequestParam String projectRoot,
            @RequestParam(defaultValue = "cyclonedx") String format) {
        try {
            String json = sbomService.generateCycloneDx(Path.of(projectRoot));
            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(json);
        } catch (SbomException e) {
            return ResponseEntity.badRequest().body("{\"error\": \"" + e.getMessage() + "\"}");
        }
    }
}

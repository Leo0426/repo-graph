package com.repograph.api;

import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetNotReadyException;
import com.repograph.core.asset.AssetStatus;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.authorization.AuthorizationEvidence;
import com.repograph.core.authorization.AuthorizationEvidenceService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Optional;

/**
 * 托管资产的路由、鉴权约束和资源访问证据查询 API。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/assets")
public class AuthorizationEvidenceController {

    private final AssetImportService assetImportService;
    private final AuthorizationEvidenceService authorizationEvidenceService;

    /**
     * 创建鉴权证据控制器。
     *
     * @param assetImportService            资产查询边界
     * @param authorizationEvidenceService  鉴权证据分析边界
     */
    public AuthorizationEvidenceController(
            AssetImportService assetImportService,
            AuthorizationEvidenceService authorizationEvidenceService) {
        this.assetImportService = assetImportService;
        this.authorizationEvidenceService = authorizationEvidenceService;
    }

    /**
     * 查询已就绪资产中的 Spring 路由鉴权和资源访问证据。
     *
     * @param assetId 资产标识
     * @param depth   调用图最大遍历深度
     * @return 路由证据；资产不存在时返回 404
     */
    @GetMapping("/{assetId}/authorization-evidence")
    public ResponseEntity<List<AuthorizationEvidence>> analyze(
            @PathVariable String assetId,
            @RequestParam(defaultValue = "6") int depth) {
        Optional<ImportedAsset> found = assetImportService.find(assetId);
        if (found.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        ImportedAsset asset = found.get();
        if (asset.status() != AssetStatus.READY) {
            throw new AssetNotReadyException(
                    "Asset '" + asset.assetId() + "' is not ready: " + asset.status());
        }
        return ResponseEntity.ok(authorizationEvidenceService.analyze(asset.projectId(), depth));
    }
}

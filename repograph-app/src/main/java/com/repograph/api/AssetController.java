package com.repograph.api;

import com.repograph.core.asset.AssetImportService;
import com.repograph.core.asset.AssetProfileOptions;
import com.repograph.core.asset.AssetProfileService;
import com.repograph.core.asset.ImportedAsset;
import com.repograph.core.asset.ProjectAssetProfile;
import com.repograph.core.parser.ParseStrategy;
import com.repograph.core.pipeline.IndexOptions;
import com.repograph.core.pipeline.IndexResult;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * 不可信源码归档接入、状态查询和删除 REST API。
 *
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/assets")
public class AssetController {

    private final AssetImportService assetImportService;
    private final AssetProfileService assetProfileService;

    /**
     * 创建资产接入控制器。
     *
     * @param assetImportService 资产接入应用边界
     * @param assetProfileService 资产画像生成边界
     */
    public AssetController(
            AssetImportService assetImportService,
            AssetProfileService assetProfileService) {
        this.assetImportService = assetImportService;
        this.assetProfileService = assetProfileService;
    }

    /**
     * 上传 ZIP/TAR.GZ 源码归档，安全提取后异步启动索引。
     *
     * @param file     归档文件
     * @param lang     可选逗号分隔语言列表
     * @param strategy 解析策略
     * @return 202 Accepted 及资产轮询信息
     * @throws IOException 上传流读取失败
     */
    @PostMapping(path = "/import", consumes = "multipart/form-data")
    public ResponseEntity<AssetResponse> importArchive(
            @RequestParam MultipartFile file,
            @RequestParam(required = false) String lang,
            @RequestParam(defaultValue = "auto") String strategy) throws IOException {
        if (file.isEmpty()) {
            throw new IllegalArgumentException("Archive file is required");
        }
        List<String> languages = lang == null || lang.isBlank()
                ? List.of()
                : Arrays.stream(lang.split(","))
                        .map(String::trim)
                        .filter(value -> !value.isBlank())
                        .toList();
        ParseStrategy parseStrategy = ParseStrategy.valueOf(strategy.toUpperCase());
        ImportedAsset asset;
        try (var input = file.getInputStream()) {
            asset = assetImportService.importArchive(
                    input, file.getOriginalFilename(), file.getSize(),
                    new IndexOptions(languages, parseStrategy, true, null));
        }
        return ResponseEntity.accepted().body(toResponse(asset));
    }

    /**
     * 查询资产索引状态。
     *
     * @param assetId 资产 ID
     * @return 资产状态；不存在时 404
     */
    @GetMapping("/{assetId}")
    public ResponseEntity<AssetResponse> find(@PathVariable String assetId) {
        return assetImportService.find(assetId)
                .map(asset -> ResponseEntity.ok(toResponse(asset)))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * 生成已就绪资产的当前画像。
     *
     * @param assetId        资产 ID
     * @param includeScanner 强制包含的扫描器，可重复传入
     * @param excludeScanner 强制排除的扫描器，可重复传入，冲突时排除优先
     * @return 当前资产画像；资产不存在时 404
     */
    @GetMapping("/{assetId}/profile")
    public ResponseEntity<ProjectAssetProfile> profile(
            @PathVariable String assetId,
            @RequestParam(required = false) List<String> includeScanner,
            @RequestParam(required = false) List<String> excludeScanner) {
        return assetImportService.find(assetId)
                .map(asset -> ResponseEntity.ok(assetProfileService.build(
                        asset,
                        new AssetProfileOptions(
                                toScannerSet(includeScanner),
                                toScannerSet(excludeScanner)))))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /**
     * 删除资产及其全部索引、漏洞、历史和受控源码。
     *
     * @param assetId 资产 ID
     * @return 删除结果；不存在时 404
     */
    @DeleteMapping("/{assetId}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String assetId) {
        if (!assetImportService.delete(assetId)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of("status", "deleted", "assetId", assetId));
    }

    private static AssetResponse toResponse(ImportedAsset asset) {
        return new AssetResponse(
                asset.assetId(),
                asset.projectId(),
                asset.originalFileName(),
                asset.archiveType(),
                asset.projectRoot().toString(),
                asset.status().name(),
                asset.error(),
                asset.createdAt(),
                asset.updatedAt(),
                asset.indexResult(),
                "/api/v1/assets/" + asset.assetId());
    }

    private static LinkedHashSet<String> toScannerSet(List<String> scanners) {
        return scanners == null ? new LinkedHashSet<>() : new LinkedHashSet<>(scanners);
    }

    /**
     * 资产接入和查询响应。
     *
     * @param assetId          资产 ID
     * @param projectId        项目 ID
     * @param originalFileName 原始文件名
     * @param archiveType      实际归档格式
     * @param projectRoot      RepoGraph 受控项目根目录
     * @param status           INDEXING、READY 或 FAILED
     * @param error            失败摘要
     * @param createdAt        创建时间
     * @param updatedAt        最近更新时间
     * @param indexResult      索引统计
     * @param pollUrl          状态轮询地址
     */
    public record AssetResponse(
            String assetId,
            String projectId,
            String originalFileName,
            String archiveType,
            String projectRoot,
            String status,
            String error,
            String createdAt,
            String updatedAt,
            IndexResult indexResult,
            String pollUrl
    ) {}
}

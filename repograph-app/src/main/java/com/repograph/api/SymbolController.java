package com.repograph.api;

import com.repograph.core.model.CodeUnit;
import com.repograph.core.vector.VectorStore;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 符号精确查询 REST API，支持按全限定名查找和按文件位置定位。
 *
 * @author leolu
 * @since 0.1.0
 */
@RestController
@RequestMapping("/api/v1")
public class SymbolController {

    private final VectorStore vectorStore;

    /**
     * 通过构造器注入向量存储。
     *
     * @param vectorStore 向量存储服务，不为 {@code null}
     */
    public SymbolController(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    /**
     * 按全限定名精确查找代码单元。
     *
     * @param qualifiedName URL 编码的全限定名
     * @return 匹配的 {@link CodeUnit}，不存在时返回 404
     */
    @GetMapping("/symbol/{qualifiedName}")
    public ResponseEntity<CodeUnit> symbol(@PathVariable String qualifiedName) {
        return vectorStore.symbolLookup(qualifiedName)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 按文件路径和行号定位包含该行的最小粒度代码单元。
     *
     * @param file 文件相对路径，不为 {@code null}
     * @param line 目标行号，1-based
     * @return 包含该行的 {@link CodeUnit}，不存在时返回 404
     */
    @GetMapping("/locate")
    public ResponseEntity<CodeUnit> locate(
            @RequestParam String file,
            @RequestParam int line) {
        return vectorStore.locateByPosition(file, line)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}

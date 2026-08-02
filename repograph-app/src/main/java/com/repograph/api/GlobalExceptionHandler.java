package com.repograph.api;

import com.repograph.asset.ArchiveLimitException;
import com.repograph.asset.InvalidArchiveException;
import com.repograph.asset.UnsafeArchiveException;
import com.repograph.asset.UnsupportedArchiveException;
import com.repograph.core.asset.AssetBusyException;
import com.repograph.core.asset.AssetNotReadyException;
import com.repograph.core.finding.ReviewQueueEntryNotFoundException;
import com.repograph.core.finding.RuleNotFoundException;
import com.repograph.core.finding.RuleTransitionException;
import com.repograph.core.scanner.ScanTaskNotFoundException;
import com.repograph.finding.ExternalFindingImportException;
import com.repograph.finding.github.GitHubCommentException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.util.Map;

/**
 * 全局 REST API 异常处理器，将常见运行时异常转换为结构化 HTTP 错误响应。
 *
 * <p>处理规则：
 * <ul>
 *   <li>{@link IllegalArgumentException} → 400 Bad Request（如无效的 ParseStrategy 枚举值）</li>
 *   <li>{@link MissingServletRequestParameterException} → 400 Bad Request（必填参数缺失）</li>
 *   <li>{@link MethodArgumentTypeMismatchException} → 400 Bad Request（参数类型不匹配）</li>
 *   <li>{@link GitHubCommentException} → 502 Bad Gateway（GitHub token 未配置或调用失败）</li>
 *   <li>其他未捕获的 {@link RuntimeException} → 500 Internal Server Error</li>
 * </ul>
 *
 * @author leolu
 * @since 0.1.0
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * 处理损坏、空或包含不安全条目的归档。
     *
     * @param ex 归档校验异常
     * @return 400 Bad Request
     */
    @ExceptionHandler({InvalidArchiveException.class, UnsafeArchiveException.class})
    public ResponseEntity<Map<String, String>> handleInvalidArchive(RuntimeException ex) {
        log.debug("Archive rejected: {}", ex.getMessage());
        return ResponseEntity.badRequest().body(Map.of(
                "code", ex instanceof UnsafeArchiveException ? "ARCHIVE_UNSAFE" : "ARCHIVE_INVALID",
                "error", messageOr(ex, "Archive is invalid")));
    }

    /**
     * 处理不支持的归档格式。
     *
     * @param ex 格式异常
     * @return 415 Unsupported Media Type
     */
    @ExceptionHandler(UnsupportedArchiveException.class)
    public ResponseEntity<Map<String, String>> handleUnsupportedArchive(UnsupportedArchiveException ex) {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(Map.of("code", "ARCHIVE_UNSUPPORTED",
                        "error", messageOr(ex, "Archive format is unsupported")));
    }

    /**
     * 处理上传或解压资源超限。
     *
     * @param ex 限额异常
     * @return 413 Payload Too Large
     */
    @ExceptionHandler({ArchiveLimitException.class, MaxUploadSizeExceededException.class})
    public ResponseEntity<Map<String, String>> handleArchiveLimit(Exception ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(Map.of("code", "ARCHIVE_LIMIT_EXCEEDED",
                        "error", messageOr(ex, "Archive exceeds configured limit")));
    }

    /**
     * 处理索引中资产的冲突操作。
     *
     * @param ex 资产忙异常
     * @return 409 Conflict
     */
    @ExceptionHandler(AssetBusyException.class)
    public ResponseEntity<Map<String, String>> handleAssetBusy(AssetBusyException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("code", "ASSET_BUSY", "error", messageOr(ex, "Asset is busy")));
    }

    /**
     * 处理尚未完成索引的资产画像请求。
     *
     * @param ex 资产未就绪异常
     * @return 409 Conflict
     */
    @ExceptionHandler(AssetNotReadyException.class)
    public ResponseEntity<Map<String, String>> handleAssetNotReady(AssetNotReadyException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("code", "ASSET_NOT_READY", "error", messageOr(ex, "Asset is not ready")));
    }

    /**
     * 处理非法参数异常，返回 400 Bad Request，消息直接透传给调用方。
     *
     * @param ex 捕获到的 {@link IllegalArgumentException}
     * @return 含 {@code error} 字段的 400 响应体
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleIllegalArgument(IllegalArgumentException ex) {
        log.debug("Bad request: {}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(Map.of("error", ex.getMessage() != null ? ex.getMessage() : "Invalid argument"));
    }

    /**
     * 处理必填请求参数缺失，返回 400 Bad Request，指明缺失的参数名。
     *
     * @param ex 捕获到的 {@link MissingServletRequestParameterException}
     * @return 含 {@code error} 字段的 400 响应体
     */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<Map<String, String>> handleMissingParam(
            MissingServletRequestParameterException ex) {
        log.debug("Missing required parameter: {}", ex.getParameterName());
        return ResponseEntity.badRequest()
                .body(Map.of("error", "Missing required parameter: " + ex.getParameterName()));
    }

    /**
     * 处理请求参数类型不匹配（如 {@code line=abc}），返回 400 Bad Request。
     *
     * @param ex 捕获到的 {@link MethodArgumentTypeMismatchException}
     * @return 含 {@code error} 字段的 400 响应体
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, String>> handleTypeMismatch(
            MethodArgumentTypeMismatchException ex) {
        String message = "Invalid value '" + ex.getValue() + "' for parameter '" + ex.getName() + "'";
        log.debug("Type mismatch: {}", message);
        return ResponseEntity.badRequest().body(Map.of("error", message));
    }

    /**
     * 处理外部报警导入失败（JSON 无效或格式不兼容），返回 400 Bad Request。
     *
     * @param ex 捕获到的 {@link ExternalFindingImportException}
     * @return 含 {@code error} 字段的 400 响应体
     */
    @ExceptionHandler(ExternalFindingImportException.class)
    public ResponseEntity<Map<String, String>> handleFindingImport(
            ExternalFindingImportException ex) {
        log.debug("Finding import failed: {}", ex.getMessage());
        return ResponseEntity.badRequest()
                .body(Map.of("error", ex.getMessage() != null ? ex.getMessage() : "Import failed"));
    }

    /**
     * 处理 GitHub PR 评论发布失败（token 未配置或 GitHub REST API 调用出错），
     * 返回 502 Bad Gateway——问题在下游/配置，不是调用方请求本身有误。
     *
     * @param ex 捕获到的 {@link GitHubCommentException}
     * @return 含 {@code error} 字段的 502 响应体
     */
    @ExceptionHandler(GitHubCommentException.class)
    public ResponseEntity<Map<String, String>> handleGitHubComment(GitHubCommentException ex) {
        log.warn("GitHub PR comment failed: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(Map.of("error", ex.getMessage() != null ? ex.getMessage() : "GitHub comment failed"));
    }

    /**
     * 处理审核队列条目或报告快照不存在，返回 404 Not Found。
     *
     * @param ex 捕获到的 {@link ReviewQueueEntryNotFoundException}
     * @return 含 {@code error} 字段的 404 响应体
     */
    @ExceptionHandler(ReviewQueueEntryNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleReviewQueueEntryNotFound(
            ReviewQueueEntryNotFoundException ex) {
        log.debug("Review queue entry not found: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", messageOr(ex, "Review queue entry not found")));
    }

    /**
     * 处理规则或版本不存在，返回 404 Not Found。
     *
     * @param ex 规则不存在异常
     * @return 结构化 404 响应
     */
    @ExceptionHandler(RuleNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleRuleNotFound(RuleNotFoundException ex) {
        log.debug("Rule not found: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("code", "RULE_NOT_FOUND", "error", messageOr(ex, "Rule not found")));
    }

    /**
     * 处理非法生命周期迁移或回归闸门拒绝，返回 409 Conflict。
     *
     * @param ex 规则迁移冲突
     * @return 结构化 409 响应
     */
    @ExceptionHandler(RuleTransitionException.class)
    public ResponseEntity<Map<String, String>> handleRuleTransition(RuleTransitionException ex) {
        log.debug("Rule transition rejected: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("code", "RULE_TRANSITION_REJECTED",
                        "error", messageOr(ex, "Rule transition rejected")));
    }

    /**
     * 处理扫描任务不存在，返回 404 Not Found。
     *
     * @param ex 捕获到的 {@link ScanTaskNotFoundException}
     * @return 含 {@code error} 字段的 404 响应体
     */
    @ExceptionHandler(ScanTaskNotFoundException.class)
    public ResponseEntity<Map<String, String>> handleScanTaskNotFound(ScanTaskNotFoundException ex) {
        log.debug("Scan task not found: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", messageOr(ex, "Scan task not found")));
    }

    /**
     * 兜底处理所有未明确处理的运行时异常，返回 500 Internal Server Error。
     *
     * <p>仅记录 ERROR 级日志，不向调用方泄露内部堆栈信息。
     *
     * @param ex 捕获到的未预期异常
     * @return 含 {@code error} 字段的 500 响应体
     */
    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Map<String, String>> handleRuntimeException(RuntimeException ex) {
        log.error("Unexpected error: {}", ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error"));
    }

    private static String messageOr(Exception exception, String fallback) {
        return exception.getMessage() == null || exception.getMessage().isBlank()
                ? fallback
                : exception.getMessage();
    }
}

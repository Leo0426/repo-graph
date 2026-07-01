package com.repograph.api;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.Map;

/**
 * 全局 REST API 异常处理器，将常见运行时异常转换为结构化 HTTP 错误响应。
 *
 * <p>处理规则：
 * <ul>
 *   <li>{@link IllegalArgumentException} → 400 Bad Request（如无效的 ParseStrategy 枚举值）</li>
 *   <li>{@link MissingServletRequestParameterException} → 400 Bad Request（必填参数缺失）</li>
 *   <li>{@link MethodArgumentTypeMismatchException} → 400 Bad Request（参数类型不匹配）</li>
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
}

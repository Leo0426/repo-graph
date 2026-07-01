package com.repograph.core.parser;

/**
 * 源文件解析失败时抛出的非受检异常，通常由 I/O 错误或编码不支持引起。
 *
 * <p>解析器实现应在文件不可读或内容无法解码时抛出此异常；
 * 语法错误通常不抛出，而是记录 WARN 日志并跳过相关符号。
 *
 * @author leolu
 * @since 0.1.0
 */
public class ParseException extends RuntimeException {

    /**
     * 使用错误消息构造异常。
     *
     * @param message 描述失败原因的消息
     */
    public ParseException(String message) {
        super(message);
    }

    /**
     * 使用错误消息和原始异常构造异常。
     *
     * @param message 描述失败原因的消息
     * @param cause   原始异常
     */
    public ParseException(String message, Throwable cause) {
        super(message, cause);
    }

    /**
     * 使用原始异常构造异常。
     *
     * @param cause 原始异常，不为 {@code null}
     */
    public ParseException(Throwable cause) {
        super(cause);
    }
}

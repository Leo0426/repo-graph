package com.repograph.sbom;

/**
 * SBOM 生成失败时抛出的非受检异常。
 *
 * @author leolu
 * @since 0.1.0
 */
public class SbomException extends RuntimeException {

    /**
     * 使用错误消息构造异常。
     *
     * @param message 描述失败原因的消息
     */
    public SbomException(String message) {
        super(message);
    }

    /**
     * 使用错误消息和原始异常构造异常。
     *
     * @param message 描述失败原因的消息
     * @param cause   原始异常
     */
    public SbomException(String message, Throwable cause) {
        super(message, cause);
    }
}

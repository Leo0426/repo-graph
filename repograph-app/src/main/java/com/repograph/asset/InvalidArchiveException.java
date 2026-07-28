package com.repograph.asset;

/**
 * 归档为空、损坏或无法读取。
 *
 * @author leolu
 */
public class InvalidArchiveException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建无效归档异常。
     *
     * @param message 可安全返回调用方的错误说明
     */
    public InvalidArchiveException(String message) {
        super(message);
    }

    /**
     * 创建带底层原因的无效归档异常。
     *
     * @param message 可安全返回调用方的错误说明
     * @param cause   底层 I/O 异常
     */
    public InvalidArchiveException(String message, Throwable cause) {
        super(message, cause);
    }
}

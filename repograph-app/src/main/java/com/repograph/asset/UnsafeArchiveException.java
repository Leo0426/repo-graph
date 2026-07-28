package com.repograph.asset;

/**
 * 归档包含路径逃逸、链接或其他不安全条目。
 *
 * @author leolu
 */
public class UnsafeArchiveException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建不安全归档异常。
     *
     * @param message 可安全返回调用方的错误说明
     */
    public UnsafeArchiveException(String message) {
        super(message);
    }
}

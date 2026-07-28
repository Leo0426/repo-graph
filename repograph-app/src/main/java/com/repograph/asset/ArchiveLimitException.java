package com.repograph.asset;

/**
 * 归档上传或解压资源超过配置限额。
 *
 * @author leolu
 */
public class ArchiveLimitException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建限额异常。
     *
     * @param message 可安全返回调用方的错误说明
     */
    public ArchiveLimitException(String message) {
        super(message);
    }
}

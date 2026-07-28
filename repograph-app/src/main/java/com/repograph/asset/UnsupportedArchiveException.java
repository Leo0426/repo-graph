package com.repograph.asset;

/**
 * 上传内容不是受支持的 ZIP 或 TAR.GZ 格式。
 *
 * @author leolu
 */
public class UnsupportedArchiveException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建不支持格式异常。
     *
     * @param message 可安全返回调用方的错误说明
     */
    public UnsupportedArchiveException(String message) {
        super(message);
    }
}

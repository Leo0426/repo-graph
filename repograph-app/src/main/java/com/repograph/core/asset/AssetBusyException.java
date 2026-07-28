package com.repograph.core.asset;

/**
 * 资产仍在索引中，当前操作会与后台任务冲突。
 *
 * @author leolu
 */
public class AssetBusyException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建资产忙异常。
     *
     * @param message 错误说明
     */
    public AssetBusyException(String message) {
        super(message);
    }
}

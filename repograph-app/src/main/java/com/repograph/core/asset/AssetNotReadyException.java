package com.repograph.core.asset;

/**
 * 资产尚未完成索引，暂时不能执行依赖索引结果的操作。
 *
 * @author leolu
 */
public class AssetNotReadyException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建资产未就绪异常。
     *
     * @param message 错误说明
     */
    public AssetNotReadyException(String message) {
        super(message);
    }
}

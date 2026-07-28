package com.repograph.core.asset;

/**
 * 托管源码资产的索引生命周期状态。
 *
 * @author leolu
 */
public enum AssetStatus {
    /** 归档已安全提取，正在执行索引。 */
    INDEXING,
    /** 索引已成功完成。 */
    READY,
    /** 索引失败，源码保留供诊断或删除。 */
    FAILED
}

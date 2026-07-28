package com.repograph.core.asset;

/**
 * 资产源码文件分类。
 *
 * @author leolu
 */
public enum AssetFileCategory {
    /** 业务源码、构建文件和运行配置。 */
    BUSINESS,
    /** 测试源码与测试资源。 */
    TEST,
    /** 文档与说明文件。 */
    DOCUMENTATION,
    /** 构建产物、依赖副本和生成代码。 */
    GENERATED,
    /** 无法可靠分类的文件。 */
    UNKNOWN
}

package com.repograph.core.model;

/**
 * 代码知识图谱中关系边的类型枚举。
 *
 * <p>EXTENDS 和 IMPLEMENTS 必须分开存储，不可合并为同一种边类型，因为两者在影响面分析时语义不同。
 *
 * @author leolu
 * @since 0.1.0
 */
public enum EdgeKind {

    /** 文件或类包含成员（File/Class → CodeUnit）。 */
    CONTAINS,

    /** 方法或函数调用关系（Method/Function → Method/Function）。 */
    CALLS,

    /** 文件级 import/include 解析到目标文件（File → File）。 */
    IMPORTS,

    /** 类继承关系，Java extends / C++ 继承（Class → Class）。不可与 IMPLEMENTS 合并。 */
    EXTENDS,

    /** 接口实现关系，Java implements（Class → Interface）。不可与 EXTENDS 合并。 */
    IMPLEMENTS,

    /** 变量或字段的类型绑定（Variable/Field → Class）。 */
    DEFINES_TYPE,

    /** 子类方法覆盖父类方法，Java 特有（Method → Method）。 */
    OVERRIDES
}

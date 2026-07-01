package com.repograph.metrics;

import java.util.List;

/**
 * 一组互相循环依赖的包（强连通分量，size ≥ 2）。
 *
 * <p>包间循环依赖是典型的架构腐化信号，会使模块化、可测试性和增量编译能力下降。
 *
 * @param packages 参与循环的包名列表，顺序不定（由 SCC 遍历决定）
 * @author leolu
 * @since 0.6.0
 */
public record PackageCycle(List<String> packages) {}

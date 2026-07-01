package com.repograph.core.flow;

import java.util.List;

/**
 * 方法级数据流摘要。
 *
 * @param parameters    方法参数名
 * @param fieldReads    读取的实例字段名
 * @param fieldWrites   写入的实例字段名
 * @param returnSources 返回表达式引用的变量或字段名
 * @author leolu
 */
public record DataFlowSummary(
        List<String> parameters,
        List<String> fieldReads,
        List<String> fieldWrites,
        List<String> returnSources
) {}

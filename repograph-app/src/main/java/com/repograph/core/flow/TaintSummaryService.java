package com.repograph.core.flow;

import com.repograph.core.model.CodeUnit;

import java.util.Optional;

/**
 * 为单个方法计算方法内污点摘要（flow-insensitive）。
 */
public interface TaintSummaryService {

    /**
     * 分析指定代码单元，返回方法内污点传播摘要。
     *
     * @param unit 方法或构造器代码单元
     * @return 支持且解析成功时返回摘要，否则返回空
     */
    Optional<MethodTaintSummary> summarize(CodeUnit unit);
}

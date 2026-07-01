package com.repograph.core.flow;

import com.repograph.core.model.CodeUnit;

import java.util.Optional;

/**
 * 按需分析单个方法或函数的数据流、控制流和程序依赖关系。
 *
 * @author leolu
 */
public interface FlowAnalysisService {

    /**
     * 分析指定代码单元。
     *
     * @param unit 方法、构造器或函数代码单元
     * @return 支持且解析成功时返回结果，否则返回空
     */
    Optional<FlowAnalysisResult> analyze(CodeUnit unit);
}

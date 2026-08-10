package com.repograph.core.architecture;

import java.util.function.Consumer;

/**
 * 架构评审模型 seam。
 *
 * @author leolu
 */
public interface ArchitectureReviewModel {

    /**
     * 返回当前模型是否可用。
     *
     * @return 可用时为 true
     */
    boolean available();

    /**
     * 返回模型标识。
     *
     * @return 提供方与模型名称
     */
    String modelId();

    /**
     * 根据受约束事实生成架构建议。
     *
     * @param input 评审事实包
     * @return 结构化建议
     */
    ArchitectureModelResponse review(ArchitectureReviewInput input);

    /**
     * 流式生成架构建议；默认适配器可退化为同步调用。
     *
     * @param input         评审事实包
     * @param deltaConsumer 模型公开输出增量接收器
     * @return 完整结构化建议
     */
    default ArchitectureModelResponse reviewStreaming(
            ArchitectureReviewInput input, Consumer<String> deltaConsumer) {
        return review(input);
    }
}

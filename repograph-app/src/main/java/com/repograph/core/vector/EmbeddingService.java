package com.repograph.core.vector;

import java.util.List;

/**
 * 将文本字符串转换为稠密向量表示的 Embedding 服务接口。
 *
 * <p>默认实现基于 Ollama {@code nomic-embed-code} 模型，向量维度为 768。
 * 启动时需通过 health check 验证服务可用性，不可用时明确报错。
 *
 * @author leolu
 * @since 0.1.0
 */
public interface EmbeddingService {

    /**
     * 批量将文本列表转换为向量列表。
     *
     * <p>输出列表与输入列表等长，顺序一一对应。建议批量大小不超过 32 以避免 OOM。
     *
     * @param texts 待 embedding 的文本列表，不为 {@code null}；空列表时返回空列表
     * @return 与 {@code texts} 等长的向量列表，每个元素为 {@code float[]} 向量；不为 {@code null}
     * @throws EmbeddingException Ollama 服务不可用或请求超时时抛出
     */
    List<float[]> embed(List<String> texts);
}

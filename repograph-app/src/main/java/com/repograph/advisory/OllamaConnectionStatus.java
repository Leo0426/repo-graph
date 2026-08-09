package com.repograph.advisory;

import java.util.List;

/**
 * Ollama 连接与目标模型可用性检测结果。
 *
 * @param reachable      服务是否可达
 * @param modelAvailable 目标模型是否已安装
 * @param message        面向用户的状态摘要
 * @param models         服务端已安装模型
 * @author leolu
 */
public record OllamaConnectionStatus(
        boolean reachable,
        boolean modelAvailable,
        String message,
        List<String> models) {

    /**
     * 创建不可变连接状态。
     */
    public OllamaConnectionStatus {
        models = models == null ? List.of() : List.copyOf(models);
    }
}

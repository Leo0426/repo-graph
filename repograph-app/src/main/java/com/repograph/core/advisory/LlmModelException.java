package com.repograph.core.advisory;

/**
 * 模型适配器异常，显式声明是否允许重试。
 *
 * @author leolu
 */
public class LlmModelException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final boolean retryable;

    /**
     * 创建模型异常。
     *
     * @param message   安全错误摘要，不得包含提示词或源码
     * @param retryable 是否允许重试
     */
    public LlmModelException(String message, boolean retryable) {
        super(message);
        this.retryable = retryable;
    }

    /**
     * 返回是否允许重试。
     *
     * @return 可重试时为 {@code true}
     */
    public boolean retryable() {
        return retryable;
    }
}

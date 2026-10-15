package com.repograph.core.wiki;

/**
 * 分层摘要模型调用失败。
 *
 * @author leolu
 * @since 0.7.0
 */
public class WikiModelException extends RuntimeException {

    public WikiModelException(String message) {
        super(message);
    }

    public WikiModelException(String message, Throwable cause) {
        super(message, cause);
    }
}

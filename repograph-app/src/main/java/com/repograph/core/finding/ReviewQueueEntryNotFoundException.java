package com.repograph.core.finding;

/**
 * 审核队列条目不存在，或请求的状态迁移在当前状态下不合法。
 *
 * @author leolu
 */
public class ReviewQueueEntryNotFoundException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建异常。
     *
     * @param message 错误说明
     */
    public ReviewQueueEntryNotFoundException(String message) {
        super(message);
    }
}

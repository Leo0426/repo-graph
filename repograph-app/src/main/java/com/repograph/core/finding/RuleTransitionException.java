package com.repograph.core.finding;

/**
 * 规则生命周期迁移或发布闸门拒绝操作时抛出的冲突异常。
 *
 * @author leolu
 */
public class RuleTransitionException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建规则迁移异常。
     *
     * @param message 可安全返回调用方的冲突说明
     */
    public RuleTransitionException(String message) {
        super(message);
    }
}

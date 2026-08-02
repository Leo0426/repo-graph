package com.repograph.core.finding;

/**
 * 查询的检测规则或版本不存在。
 *
 * @author leolu
 */
public class RuleNotFoundException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建规则不存在异常。
     *
     * @param message 可安全返回调用方的说明
     */
    public RuleNotFoundException(String message) {
        super(message);
    }
}

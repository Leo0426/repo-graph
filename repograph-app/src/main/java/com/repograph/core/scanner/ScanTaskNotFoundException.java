package com.repograph.core.scanner;

/**
 * 扫描任务不存在。
 *
 * @author leolu
 */
public class ScanTaskNotFoundException extends RuntimeException {

    /**
     * @param message 错误信息
     */
    public ScanTaskNotFoundException(String message) {
        super(message);
    }
}

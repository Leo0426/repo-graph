package com.repograph.finding;

/**
 * 外部 SAST 报警导入失败异常。
 *
 * @author leolu
 */
public class ExternalFindingImportException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * 创建导入失败异常。
     *
     * @param message 错误说明
     */
    public ExternalFindingImportException(String message) {
        super(message);
    }

    /**
     * 创建导入失败异常。
     *
     * @param message 错误说明
     * @param cause   原始异常
     */
    public ExternalFindingImportException(String message, Throwable cause) {
        super(message, cause);
    }
}

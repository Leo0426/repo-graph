package com.repograph.finding.github;

/**
 * GitHub PR 评论发送失败时抛出：token 未配置，或调用 GitHub REST API 出错。
 *
 * @author leolu
 * @since 0.1.0
 */
public class GitHubCommentException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * @param message 错误描述
     */
    public GitHubCommentException(String message) {
        super(message);
    }

    /**
     * @param message 错误描述
     * @param cause   原始异常
     */
    public GitHubCommentException(String message, Throwable cause) {
        super(message, cause);
    }
}

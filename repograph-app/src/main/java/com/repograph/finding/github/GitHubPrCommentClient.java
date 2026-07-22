package com.repograph.finding.github;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

/**
 * GitHub PR 评论客户端，调用 GitHub REST API 在 Pull Request 上发布评论。
 *
 * <p>GitHub 把 PR 评论建模为 issue 评论，端点为
 * {@code POST /repos/{owner}/{repo}/issues/{number}/comments}，对 PR 编号同样适用。
 *
 * @author leolu
 * @since 0.1.0
 */
@Service
public class GitHubPrCommentClient {

    private static final Logger log = LoggerFactory.getLogger(GitHubPrCommentClient.class);

    private final GitHubProperties properties;
    private final RestTemplate restTemplate;

    /**
     * @param properties   GitHub 集成配置，不为 {@code null}
     * @param restTemplate Spring RestTemplate 实例（{@code githubRestTemplate} bean），不为 {@code null}
     */
    public GitHubPrCommentClient(GitHubProperties properties,
                                  @Qualifier("githubRestTemplate") RestTemplate restTemplate) {
        this.properties = properties;
        this.restTemplate = restTemplate;
    }

    /**
     * 在指定 PR 上发布一条评论。
     *
     * @param owner     仓库所有者（用户名或组织名）
     * @param repo      仓库名
     * @param prNumber  PR 编号
     * @param body      评论 Markdown 正文
     * @return GitHub 返回的评论网页 URL（{@code html_url}）
     * @throws GitHubCommentException token 未配置，或调用 GitHub REST API 失败
     */
    public String postComment(String owner, String repo, int prNumber, String body) {
        if (properties.token() == null || properties.token().isBlank()) {
            throw new GitHubCommentException(
                    "GitHub token not configured (repograph.github.token); cannot post PR comment");
        }

        String url = properties.apiBaseUrl() + "/repos/" + owner + "/" + repo
                + "/issues/" + prNumber + "/comments";
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(properties.token());
        headers.set("Accept", "application/vnd.github+json");
        HttpEntity<Map<String, String>> entity = new HttpEntity<>(Map.of("body", body), headers);

        try {
            ResponseEntity<Map> response = restTemplate.postForEntity(url, entity, Map.class);
            Object htmlUrl = response.getBody() != null ? response.getBody().get("html_url") : null;
            String result = htmlUrl != null ? htmlUrl.toString() : url;
            log.info("Posted triage comment to {}/{}#{}: {}", owner, repo, prNumber, result);
            return result;
        } catch (RestClientException e) {
            throw new GitHubCommentException(
                    "Failed to post PR comment to " + owner + "/" + repo + "#" + prNumber
                            + ": " + e.getMessage(), e);
        }
    }
}

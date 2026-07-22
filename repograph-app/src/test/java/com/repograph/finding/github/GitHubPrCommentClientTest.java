package com.repograph.finding.github;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link GitHubPrCommentClient} 行为测试。
 *
 * @author leolu
 */
class GitHubPrCommentClientTest {

    private final RestTemplate restTemplate = mock(RestTemplate.class);

    @Test
    void postComment_returnsHtmlUrlFromResponse() {
        GitHubPrCommentClient client = new GitHubPrCommentClient(
                new GitHubProperties("ghp_test", "https://api.github.com", 15), restTemplate);
        when(restTemplate.postForEntity(
                eq("https://api.github.com/repos/leo/demo/issues/42/comments"),
                any(HttpEntity.class), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("html_url",
                        "https://github.com/leo/demo/pull/42#issuecomment-1")));

        String url = client.postComment("leo", "demo", 42, "## report");

        assertThat(url).isEqualTo("https://github.com/leo/demo/pull/42#issuecomment-1");
    }

    @Test
    void postComment_sendsBearerAuthAndBody() {
        GitHubPrCommentClient client = new GitHubPrCommentClient(
                new GitHubProperties("ghp_test", "https://api.github.com", 15), restTemplate);
        when(restTemplate.postForEntity(any(String.class), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of()));

        client.postComment("leo", "demo", 7, "## report body");

        org.mockito.ArgumentCaptor<HttpEntity> captor = org.mockito.ArgumentCaptor.forClass(HttpEntity.class);
        verify(restTemplate).postForEntity(
                eq("https://api.github.com/repos/leo/demo/issues/7/comments"), captor.capture(), eq(Map.class));
        assertThat(captor.getValue().getHeaders().getFirst("Authorization")).isEqualTo("Bearer ghp_test");
        assertThat(captor.getValue().getBody()).isEqualTo(Map.of("body", "## report body"));
    }

    @Test
    void postComment_throwsWhenTokenNotConfigured() {
        GitHubPrCommentClient client = new GitHubPrCommentClient(
                new GitHubProperties("", "https://api.github.com", 15), restTemplate);

        assertThatThrownBy(() -> client.postComment("leo", "demo", 1, "body"))
                .isInstanceOf(GitHubCommentException.class)
                .hasMessageContaining("token");
    }

    @Test
    void postComment_wrapsRestClientExceptionAsGitHubCommentException() {
        GitHubPrCommentClient client = new GitHubPrCommentClient(
                new GitHubProperties("ghp_test", "https://api.github.com", 15), restTemplate);
        when(restTemplate.postForEntity(any(String.class), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new ResourceAccessException("connection refused"));

        assertThatThrownBy(() -> client.postComment("leo", "demo", 1, "body"))
                .isInstanceOf(GitHubCommentException.class)
                .hasMessageContaining("leo/demo#1");
    }
}

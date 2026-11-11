package com.repograph.identity;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;

/** Authentication throttling at the HTTP filter boundary with deterministic elapsed time. @author leolu */
class AuthenticationRateLimitFilterTest {
    @Test
    void limitsLoginAndRegistrationSeparatelyIgnoresSpoofedForwardingAndRecoversAfterWindow() throws Exception {
        var now = new AtomicLong();
        var filter = new AuthenticationRateLimitFilter(2, 1, 60, now::get);
        assertThat(request(filter, "/api/v1/auth/login", "1.2.3.4").getStatus()).isEqualTo(204);
        assertThat(request(filter, "/api/v1/auth/login", "5.6.7.8").getStatus()).isEqualTo(204);
        var rejected = request(filter, "/api/v1/auth/login", "9.8.7.6");
        assertThat(rejected.getStatus()).isEqualTo(429);
        assertThat(rejected.getHeader("Retry-After")).isEqualTo("60");
        assertThat(request(filter, "/api/v1/auth/register", "1.2.3.4").getStatus()).isEqualTo(204);
        assertThat(request(filter, "/api/v1/auth/register", "1.2.3.4").getStatus()).isEqualTo(429);
        assertThat(request(filter, "/api/v1/projects", "1.2.3.4").getStatus()).isEqualTo(204);
        now.addAndGet(java.util.concurrent.TimeUnit.SECONDS.toNanos(61));
        assertThat(request(filter, "/api/v1/auth/login", "1.2.3.4").getStatus()).isEqualTo(204);
    }

    private MockHttpServletResponse request(AuthenticationRateLimitFilter filter, String path, String forwarded)
            throws Exception {
        var request = new MockHttpServletRequest("POST", path);
        request.setRemoteAddr("127.0.0.1");
        request.addHeader("X-Forwarded-For", forwarded);
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, (incoming, outgoing) -> ((jakarta.servlet.http.HttpServletResponse) outgoing)
                .setStatus(204));
        return response;
    }
}

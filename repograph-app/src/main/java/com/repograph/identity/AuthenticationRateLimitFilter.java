package com.repograph.identity;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

/** Bounded per-peer authentication throttling; does not trust client-supplied forwarding headers. @author leolu */
public final class AuthenticationRateLimitFilter extends OncePerRequestFilter {
    private static final int MAX_PEERS = 4096;
    private final int loginLimit;
    private final int registrationLimit;
    private final long windowNanos;
    private final LongSupplier clock;
    private final Map<String, Window> windows = new HashMap<>();

    /** Creates a single-instance limiter with a monotonic clock. */
    public AuthenticationRateLimitFilter(int loginLimit, int registrationLimit, int windowSeconds) {
        this(loginLimit, registrationLimit, windowSeconds, System::nanoTime);
    }

    AuthenticationRateLimitFilter(int loginLimit, int registrationLimit, int windowSeconds, LongSupplier clock) {
        if (loginLimit < 1 || registrationLimit < 1 || windowSeconds < 1 || windowSeconds > 3600) {
            throw new IllegalArgumentException("Authentication limits must be positive; window must be 1..3600 seconds");
        }
        this.loginLimit = loginLimit;
        this.registrationLimit = registrationLimit;
        this.windowNanos = TimeUnit.SECONDS.toNanos(windowSeconds);
        this.clock = clock;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        return !"POST".equals(request.getMethod())
                || !(path.equals("/api/v1/auth/login") || path.equals("/api/v1/auth/register"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        boolean registration = request.getRequestURI().endsWith("/register");
        long retry = acquire(request.getRemoteAddr() + (registration ? ":register" : ":login"),
                registration ? registrationLimit : loginLimit);
        if (retry > 0) {
            response.setStatus(429);
            response.setContentType("application/json;charset=UTF-8");
            response.setHeader("Retry-After", Long.toString(retry));
            response.getWriter().write("{\"code\":\"AUTH_RATE_LIMIT\",\"error\":\"尝试过于频繁，请稍后重试\"}");
            return;
        }
        chain.doFilter(request, response);
    }

    private synchronized long acquire(String key, int limit) {
        long now = clock.getAsLong();
        Window window = windows.get(key);
        if (window == null || now - window.started >= windowNanos) {
            if (windows.size() >= MAX_PEERS) {
                windows.values().removeIf(value -> now - value.started >= windowNanos);
                if (!windows.containsKey(key) && windows.size() >= MAX_PEERS) return 1;
            }
            window = new Window(now);
            windows.put(key, window);
        }
        if (window.attempts >= limit) {
            return Math.max(1, (windowNanos - (now - window.started) + 999999999) / 1000000000);
        }
        window.attempts++;
        return 0;
    }

    private static final class Window {
        private final long started;
        private int attempts;
        private Window(long started) { this.started = started; }
    }
}

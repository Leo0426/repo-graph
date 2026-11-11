package com.repograph.api;

import com.repograph.core.identity.Account;
import com.repograph.identity.EnterpriseDirectory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Public registration and authenticated account actions. @author leolu */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final EnterpriseDirectory directory;

    /** Creates account endpoints backed by the shared directory. */
    public AuthController(EnterpriseDirectory directory) { this.directory = directory; }

    /** Returns a session-bound CSRF token, including before sign-in/registration. */
    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("token", token.getToken(), "headerName", token.getHeaderName());
    }

    /** Registers an unprivileged pending account; extra role/status fields cannot grant privileges. */
    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public Account register(@RequestBody Registration request) {
        return directory.register(request.username(), request.displayName(), request.email(), request.password());
    }

    /** Returns the current approved account after the filter revalidates its session. */
    @GetMapping("/me")
    public Account me(@AuthenticationPrincipal Account account) { return directory.account(account.id()); }

    /** Changes the current password; all sessions including this one expire on the next request. */
    @PostMapping("/password")
    public Map<String, String> password(@AuthenticationPrincipal Account account, @RequestBody PasswordChange request) {
        directory.changePassword(account.id(), request.oldPassword(), request.newPassword());
        return Map.of("status", "password_changed");
    }

    /** Public registration input, intentionally excluding role and status. */
    public record Registration(String username, String displayName, String email, String password) {
        @Override public String toString() { return "Registration[REDACTED]"; }
    }

    /** Secret-bearing password-change input, excluded from diagnostic string rendering. */
    public record PasswordChange(String oldPassword, String newPassword) {
        @Override public String toString() { return "PasswordChange[REDACTED]"; }
    }
}

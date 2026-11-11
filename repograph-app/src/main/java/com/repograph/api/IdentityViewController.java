package com.repograph.api;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/** Public login and registration page. @author leolu */
@Controller
public class IdentityViewController {
    /** Renders the sign-in and self-registration form without exposing application data. */
    @GetMapping("/login")
    public String login() { return "login"; }
}

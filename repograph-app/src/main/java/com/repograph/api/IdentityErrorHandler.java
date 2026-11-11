package com.repograph.api;

import com.repograph.identity.IdentityException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

/** Maps safe identity failures to stable HTTP errors without exposing credential material. @author leolu */
@org.springframework.core.annotation.Order(org.springframework.core.Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice
public class IdentityErrorHandler {
    /** Returns the directory's public status, code and message. */
    @ExceptionHandler(IdentityException.class)
    public ResponseEntity<Map<String, String>> identity(IdentityException failure) {
        return ResponseEntity.status(failure.status()).body(Map.of("code", failure.code(), "error", failure.getMessage()));
    }
}

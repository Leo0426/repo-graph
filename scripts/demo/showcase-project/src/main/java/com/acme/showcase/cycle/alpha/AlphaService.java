package com.acme.showcase.cycle.alpha;

import com.acme.showcase.cycle.beta.BetaService;

/**
 * Alpha side of an intentional package cycle.
 *
 * @author leolu
 */
public class AlphaService {

    private final BetaService betaService;

    /** @param betaService beta dependency */
    public AlphaService(BetaService betaService) {
        this.betaService = betaService;
    }

    /** @return beta response */
    public String alpha() {
        return betaService.beta();
    }

    /** @return shared value */
    public static String shared() {
        return "shared";
    }
}

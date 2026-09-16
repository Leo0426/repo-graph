package com.acme.showcase.cycle.beta;

import com.acme.showcase.cycle.alpha.AlphaService;

/**
 * Beta side of an intentional package cycle.
 *
 * @author leolu
 */
public class BetaService {

    /** @return alpha-owned shared value */
    public String beta() {
        return AlphaService.shared();
    }
}

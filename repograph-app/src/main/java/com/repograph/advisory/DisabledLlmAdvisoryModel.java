package com.repograph.advisory;

import com.repograph.core.advisory.LlmAdvisoryModel;
import com.repograph.core.advisory.LlmAdvisoryRequest;
import com.repograph.core.advisory.LlmModelResponse;

/**
 * 默认关闭的模型适配器，不执行任何外部调用。
 *
 * @author leolu
 */
public class DisabledLlmAdvisoryModel implements LlmAdvisoryModel {

    /** {@inheritDoc} */
    @Override
    public boolean available() {
        return false;
    }

    /** {@inheritDoc} */
    @Override
    public String provider() {
        return "disabled";
    }

    /** {@inheritDoc} */
    @Override
    public String model() {
        return "";
    }

    /** {@inheritDoc} */
    @Override
    public double estimateCostUsd(int inputChars, int maxOutputChars) {
        return 0.0d;
    }

    /** {@inheritDoc} */
    @Override
    public LlmModelResponse review(LlmAdvisoryRequest request) {
        throw new IllegalStateException("LLM advisory model is disabled");
    }
}

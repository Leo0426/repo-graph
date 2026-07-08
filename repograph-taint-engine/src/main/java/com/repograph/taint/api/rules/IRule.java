/*
 * MIT License
 *
 * Copyright (c) 2023 Leo Lu.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

package com.repograph.taint.api.rules;

import com.repograph.taint.api.IPropagationTransform;
import com.repograph.taint.api.annotation.RuleService;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.api.progress.RuleActionVisitor;
import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.api.report.taint.TaintResult;

import java.util.Set;

import static com.repograph.taint.api.cache.GlobalCache.DEFAULT_KEY;

/**
 * Rules Action.
 *
 * @author leolu
 * @since 2023/10/26
 */
public interface IRule {

	default IPropagationTransform propagationTransform() {
		return GlobalCache.INSTANCE
			.get(DEFAULT_KEY)
			.getPropagationTransform();
	}

	default String getCurrentRuleNumber() {
		RuleService ruleService = this.getClass().getAnnotation(RuleService.class);
		if (ruleService != null) {
			return ruleService.number();
		}
		return "";
	}

	default String getCurrentRuleName() {
		RuleService ruleService = this.getClass().getAnnotation(RuleService.class);
		if (ruleService != null) {
			return ruleService.name();
		}
		return "";
	}

	default void progress(RuleActionVisitor visitor) {
		visitor.updateProgress(this);
	}

	default void export(RuleActionVisitor visitor, Set<BugMateInfo> bugMateInfo) {
		visitor.exportResult(this, bugMateInfo);
	}

	default void export(RuleActionVisitor visitor, TaintResult result) {
		visitor.exportResult(this, result);
	}
}

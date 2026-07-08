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

package com.repograph.taint.invoke.manager;

import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.api.rules.IRule;
import com.repograph.taint.api.rules.manager.IRuleManager;
import com.repograph.taint.invoke.factory.AbstractTaintRule;
import com.repograph.taint.report.visitor.DefaultVisitor;
import com.ibm.wala.ipa.callgraph.CallGraph;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

public class TaintRuleManager implements IRuleManager {
	private static final Logger LOGGER = LoggerFactory.getLogger(TaintRuleManager.class);

	private final List<IRule> rules;

	public TaintRuleManager(List<IRule> rules) {
		this.rules = rules;
	}

	@Override
	public void run(CallGraph callgraph) {
		rules.iterator()
			.forEachRemaining(e -> {
				try {
					LOGGER.info("Rule : {} of {} is start running...", e.getCurrentRuleNumber(), e.getCurrentRuleName());
					updateCurrentRule(e);
					((AbstractTaintRule) e).runOnTaint(callgraph);
					TaintResult taintResult = ((AbstractTaintRule) e).getTaintResult();
					e.progress(new DefaultVisitor());
					e.export(new DefaultVisitor(), taintResult);
					LOGGER.info("Rule : {} of {}  has finished analysis...", e.getCurrentRuleNumber(), e.getCurrentRuleName());
				} catch (Exception ex) {
					LOGGER.error("Rule get An exception: {}", ex.getMessage());
				}
			});
	}
}

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

import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.api.rules.IRule;
import com.repograph.taint.api.rules.manager.IRuleManager;
import com.repograph.taint.invoke.factory.AbstractMethodRule;
import com.repograph.taint.report.visitor.DefaultVisitor;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * method rule manager.
 *
 * @author leolu
 * @since 2023/10/30
 */
public class MethodRuleManager implements IRuleManager {

	private static final Logger LOGGER = LoggerFactory.getLogger(MethodRuleManager.class);

	private final List<IRule> rules;

	public MethodRuleManager(List<IRule> rules) {
		this.rules = rules;
	}

	@Override
	public void run(CallGraph callgraph) {
		rules.iterator().forEachRemaining(e -> {
			try {
				updateCurrentRule(e);
				LOGGER.info("Rule : {} of {} is start running...", e.getCurrentRuleNumber(), e.getCurrentRuleName());
				Set<BugMateInfo> resultList = new HashSet<>();
				for (CGNode cgNode : callgraph) {
					((AbstractMethodRule) e).runOnMethod(cgNode);
					Set<BugMateInfo> result = ((AbstractMethodRule) e).getResult();
					resultList.addAll(result);
				}
				e.progress(new DefaultVisitor());
				e.export(new DefaultVisitor(), resultList);
				LOGGER.info("Rule : {} of {}  has finished analysis...", e.getCurrentRuleNumber(), e.getCurrentRuleName());
			} catch (Exception ex) {
				LOGGER.error("Rule get An exception: {}", ex.getMessage());
			}
		});
	}
}

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

import com.repograph.taint.api.IPropagationTransform;
import com.repograph.taint.api.rules.IRule;
import com.repograph.taint.invoke.factory.AbstractClassRule;
import com.repograph.taint.invoke.factory.AbstractMethodRule;
import com.repograph.taint.invoke.factory.AbstractTaintRule;
import com.ibm.wala.ipa.callgraph.CallGraph;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

import static java.util.Objects.nonNull;

/**
 * rule manager.
 *
 * @author leolu
 * @since 2023/10/30
 */
public class RuleManager {
	private static final Logger LOGGER = LoggerFactory.getLogger(RuleManager.class);

	Comparator<IRule> ruleComparator = Comparator.comparing(IRule::getCurrentRuleNumber);

	private final IPropagationTransform propagationTransform;

	private final Set<IRule> rules;

	public RuleManager(IPropagationTransform propagationTransform, Set<IRule> rules) {
		this.propagationTransform = propagationTransform;
		this.rules = rules;
	}

	public void executeJobs() {

		LOGGER.info("Assembler rules information...");
		List<IRule> methodRules = new ArrayList<>();
		List<IRule> clazzRules = new ArrayList<>();
		List<IRule> taintRules = new ArrayList<>();
		rules.forEach(e -> {
			if (e instanceof AbstractClassRule) {
				clazzRules.add(e);
			}
			if (e instanceof AbstractMethodRule) {
				methodRules.add(e);
			}
			if (e instanceof AbstractTaintRule) {
				taintRules.add(e);
			}
		});

		// sorted
		methodRules.sort(ruleComparator);
		clazzRules.sort(ruleComparator);
		taintRules.sort(ruleComparator);

		LOGGER.info("Start run rules ...");
		CallGraph cgNodes = propagationTransform.getCgNodes();
		if (nonNull(cgNodes)) {
			MethodRuleManager methodRuleManager = new MethodRuleManager(methodRules);
			methodRuleManager.run(cgNodes);;

			ClassRuleManager classRuleManager = new ClassRuleManager(clazzRules);
			classRuleManager.run(cgNodes);

			TaintRuleManager taintRuleManager = new TaintRuleManager(taintRules);
			taintRuleManager.run(cgNodes);
		}
		LOGGER.info("Finished run rules ...");
	}
}

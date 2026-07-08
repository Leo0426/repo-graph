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

package com.repograph.taint.invoke.factory;

import com.repograph.taint.api.DefaultContext;
import com.repograph.taint.api.IContext;
import com.repograph.taint.api.IPropagationTransform;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.api.register.PassFactoryRegister;
import com.repograph.taint.api.rules.IRule;
import com.repograph.taint.api.rules.IRuleFactory;
import com.repograph.taint.Engine;
import com.repograph.taint.invoke.manager.RuleManager;
import com.repograph.taint.report.expoter.ProgressRateExporter;
import com.google.common.collect.Sets;
import com.ibm.wala.ipa.cha.ClassHierarchyException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.util.Set;

import static com.repograph.taint.api.cache.GlobalCache.DEFAULT_KEY;
import static java.util.Objects.nonNull;

/**
 * engine facade.
 *
 * @author leolu
 * @since 2023/11/4
 */
public class RuleFactory implements IRuleFactory {

	public static final Logger LOGGER = LoggerFactory.getLogger(RuleFactory.class);

	// registered rules
	private Set<IRule> registeredRule;

	private final IContext context;

	private IPropagationTransform propagationTransform;

	public RuleFactory(IContext context) {
		this.context = context;
	}

	public void initialize() {
		Engine engine = new Engine(this.context);
		try {
			this.propagationTransform = engine.assemblerEngine();
			completeContext();
		} catch (IOException | ClassHierarchyException e) {
			LOGGER.error("ERROR: can't initialize rules, because of : [{}}", e.getMessage());
		}
	}

	@Override
	public void registerRules() {
		try {
			PassFactoryRegister passFactory = PassFactoryRegister.getInstance();
			Set<IRule> iRules = passFactory.registerFactory();
			if (context.getRules().isEmpty()) {
				this.registeredRule = iRules;
			} else {
				this.registeredRule = passFactory.filterRunningRules(iRules, Sets.newHashSet(context.getRules()));
			}
			completeContext();
		} catch (NoSuchMethodException | InvocationTargetException | InstantiationException |
				 IllegalAccessException e) {
			LOGGER.error("ERROR: can't register rules, because of : [{}}", e.getMessage());
		}
	}

	@Override
	public void startRules() {
		if (nonNull(propagationTransform)) {
			RuleManager ruleManager = new RuleManager(propagationTransform, registeredRule);
			ruleManager.executeJobs();
		} else {
			ProgressRateExporter
				.getInstance()
				.setRatePath(this.context.getOutputPath())
				.reportRateInfo("100.00");
		}
	}

	public void completeContext() {
		DefaultContext context = this.context.toBuilder()
			.withPropagationTransform(this.propagationTransform)
			.withRegisterRules(this.registeredRule)
			.build();
		GlobalCache.INSTANCE.put(DEFAULT_KEY, context);
	}

}

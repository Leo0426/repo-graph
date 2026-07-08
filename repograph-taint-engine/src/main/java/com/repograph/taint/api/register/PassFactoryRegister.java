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

package com.repograph.taint.api.register;

import com.repograph.taint.api.annotation.RuleService;
import com.repograph.taint.api.rules.IRule;
import org.reflections.Reflections;
import org.reflections.scanners.Scanners;
import org.reflections.util.ClasspathHelper;
import org.reflections.util.ConfigurationBuilder;

import java.lang.reflect.InvocationTargetException;
import java.util.HashSet;
import java.util.Set;


/**
 * PassFactoryRegister class is a singleton factory responsible for registering
 * and retrieving all services that implement the IRule interface.
 *
 * @author leolu
 * @since 2023/8/2
 */
public class PassFactoryRegister {

	/**
	 * PassFactoryHolder is a static inner class that lazily loads the
	 * PassFactoryRegister instance. This implements the Singleton pattern
	 * in a thread-safe and efficient manner.
	 */
	public static final class PassFactoryHolder {
		private static final PassFactoryRegister INSTANT = new PassFactoryRegister();
	}

	/**
	 * Returns the singleton instance of PassFactoryRegister.
	 *
	 * @return The singleton instance of PassFactoryRegister.
	 */
	public static PassFactoryRegister getInstance() {
		return PassFactoryHolder.INSTANT;
	}

	/**
	 * Private constructor to prevent external instantiation.
	 */
	private PassFactoryRegister() {
	}

	// Defines the package path where service implementation classes are located.
	private static final String PASS_PATH = "com.repograph.java.engine.rules";

	/**
	 * Registers all classes annotated with @RuleService and returns instances
	 * of those that are enabled.
	 *
	 * @return A set containing instances of all registered IRule implementations.
	 * @throws NoSuchMethodException     If the class does not have a no-argument constructor.
	 * @throws InvocationTargetException If the constructor invocation fails.
	 * @throws InstantiationException    If the class cannot be instantiated.
	 * @throws IllegalAccessException    If access to the class constructor is not allowed.
	 */
	public Set<IRule> registerFactory() throws NoSuchMethodException, InvocationTargetException,
		InstantiationException, IllegalAccessException {

		Set<IRule> objects = new HashSet<>();

		Reflections reflections = new Reflections(new ConfigurationBuilder()
			.setUrls(ClasspathHelper.forPackage(PASS_PATH))
			.filterInputsBy(i -> i != null && i.startsWith(PASS_PATH))
			.setScanners(Scanners.SubTypes, Scanners.TypesAnnotated));

		// Get all classes annotated with @RuleService.
		Set<Class<?>> declareClazz =
			reflections.getTypesAnnotatedWith(RuleService.class, true);

		for (Class<?> clazz : declareClazz) {
			RuleService declaredAnnotation = clazz.getDeclaredAnnotation(RuleService.class);
			if (declaredAnnotation.open()) {
				IRule pass = (IRule) clazz.getDeclaredConstructor().newInstance();
				objects.add(pass);
			}
		}
		return objects;
	}

	public Set<IRule> filterRunningRules(Set<IRule> allRules, Set<String> runningRuleNumbers) {
		Set<IRule> result = new HashSet<>();
		allRules.forEach(iRule -> {
			String currentRuleNumber = iRule.getCurrentRuleNumber();
			if (runningRuleNumbers.contains(currentRuleNumber)) {
				result.add(iRule);
			}
		});
		return result;
	}
}

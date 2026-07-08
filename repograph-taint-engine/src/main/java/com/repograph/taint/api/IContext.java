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

package com.repograph.taint.api;

import com.repograph.taint.api.rules.IRule;
import com.repograph.taint.api.support.JavaFrameworkSupport;
import com.repograph.taint.api.support.SourceFileConfig;

import java.nio.file.Path;
import java.util.List;
import java.util.Set;

/**
 * Context
 *
 * @author leolu
 * @since 2023/8/3
 */
public interface IContext {

	/**
	 * result output path
	 *
	 * @return result path
	 */
	Path getOutputPath();

	/**
	 * which projects will be checked.
	 *
	 * @return projects paths
	 */
	List<Path> getTargetPath();

	/**
	 * propagation transform
	 *
	 * @return IPropagationTransform
	 */
	IPropagationTransform getPropagationTransform();

	/**
	 * get register rules.
	 *
	 * @return Set
	 */
	Set<IRule> getRegisterRules();

	/**
	 * get execute rule.
	 *
	 * @return rule
	 */
	IRule getRule();

	/**
	 * TODO: Maybe, support multi-path in future.
	 *
	 * @return set of path.
	 */
	Set<Path> getTargetAllFilePath();

	/**
	 * get list of rules.
	 *
	 * @return list of rules.
	 */
	List<String> getRules();

	/**
	 * use phantom methods.
	 *
	 * @return CheckConfig
	 */
	CheckConfig getCheckConfig();

	/**
	 * give a name to this analysis job.
	 *
	 * @return String name.
	 */
	String getTaskName();

	/**
	 * open framework scan
	 *
	 * @return JavaFrameworkSupport
	 */
	JavaFrameworkSupport getJavaFrameworkSupport();

	/**
	 * source file config.
	 *
	 * @return SourceFileConfig
	 */
	SourceFileConfig getSourceFileConfig();

	/**
	 * checker timeout setting.
	 *
	 * @return double time.
	 */
	long getCheckerTimeout();

	default Builder toBuilder() {
		return builder()
			.withTaskName(getTaskName())
			.withTargetPath(getTargetPath())
			.withOutputPath(getOutputPath())
			.withRules(getRules())
			.withPropagationTransform(getPropagationTransform())
			.withRegisterRules(getRegisterRules())
			.withTargetAllFilePath(getTargetAllFilePath())
			.withCheckConfig(getCheckConfig())
			.withCheckerTimeout(getCheckerTimeout())
			.withRule(getRule())
			.withJavaFrameworkSupport(getJavaFrameworkSupport())
			.withSourceFileConfig(getSourceFileConfig());
	}

	static Builder builder() {
		return new Builder();
	}

	final class Builder {
		private String taskName;
		private List<Path> targetPath;
		private IRule rule;
		private Path outputPath;
		private List<String> rules;
		private IPropagationTransform propagationTransform;
		private Set<IRule> registerRules;
		private Set<Path> targetAllFilePath;
		private CheckConfig checkConfig;
		private long checkerTimeout;
		private JavaFrameworkSupport javaFrameworkSupport;
		private SourceFileConfig sourceFileConfig;

		private Builder() {
		}

		public Builder withTaskName(String taskName) {
			this.taskName = taskName;
			return this;
		}

		public Builder withTargetPath(List<Path> targetPath) {
			this.targetPath = targetPath;
			return this;
		}

		public Builder withOutputPath(Path outputPath) {
			this.outputPath = outputPath;
			return this;
		}

		public Builder withRules(List<String> rules) {
			this.rules = rules;
			return this;
		}

		public Builder withPropagationTransform(IPropagationTransform propagationTransform) {
			this.propagationTransform = propagationTransform;
			return this;
		}

		public Builder withRegisterRules(Set<IRule> registerRules) {
			this.registerRules = registerRules;
			return this;
		}

		public Builder withTargetAllFilePath(Set<Path> targetAllFilePath) {
			this.targetAllFilePath = targetAllFilePath;
			return this;
		}

		public Builder withCheckConfig(CheckConfig checkConfig) {
			this.checkConfig = checkConfig;
			return this;
		}

		public Builder withCheckerTimeout(long checkerTimeout) {
			this.checkerTimeout = checkerTimeout;
			return this;
		}

		public Builder withJavaFrameworkSupport(JavaFrameworkSupport javaFrameworkSupport) {
			this.javaFrameworkSupport = javaFrameworkSupport;
			return this;
		}

		public Builder withSourceFileConfig(SourceFileConfig sourceFileConfig) {
			this.sourceFileConfig = sourceFileConfig;
			return this;
		}

		public Builder withRule(IRule rule) {
			this.rule = rule;
			return this;
		}

		public DefaultContext build() {
			DefaultContext defaultContext = new DefaultContext();
			defaultContext.setTaskName(taskName);
			defaultContext.setTargetPath(targetPath);
			defaultContext.setOutputPath(outputPath);
			defaultContext.setRules(rules);
			defaultContext.setPropagationTransform(propagationTransform);
			defaultContext.setRegisterRules(registerRules);
			defaultContext.setTargetAllFilePath(targetAllFilePath);
			defaultContext.setTaskName(taskName);
			defaultContext.setTargetPath(targetPath);
			defaultContext.setOutputPath(outputPath);
			defaultContext.setRules(rules);
			defaultContext.setPropagationTransform(propagationTransform);
			defaultContext.setRegisterRules(registerRules);
			defaultContext.setTargetAllFilePath(targetAllFilePath);
			defaultContext.setCheckConfig(checkConfig);
			defaultContext.setCheckerTimeout(checkerTimeout);
			defaultContext.setJavaFrameworkSupport(javaFrameworkSupport);
			defaultContext.setSourceFileConfig(sourceFileConfig);
			defaultContext.setCheckerTimeout(checkerTimeout);
			defaultContext.setJavaFrameworkSupport(javaFrameworkSupport);
			defaultContext.setSourceFileConfig(sourceFileConfig);
			defaultContext.setRule(rule);
			return defaultContext;
		}
	}
}

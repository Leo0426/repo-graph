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
import java.util.StringJoiner;

/**
 * default context.
 *
 * @author leolu
 * @since 2023/8/3
 */
public class DefaultContext implements IContext {

	private String taskName;

	private List<Path> targetPath;

	private Path outputPath;

	private List<String> rules;

	private IRule rule;

	private IPropagationTransform propagationTransform;

	private Set<IRule> registerRules;

	private Set<Path> targetAllFilePath;

	private CheckConfig checkConfig;

	private long checkerTimeout;

	private JavaFrameworkSupport javaFrameworkSupport;

	private SourceFileConfig sourceFileConfig;

	@Override
	public IRule getRule() {
		return rule;
	}

	public void setRule(IRule rule) {
		this.rule = rule;
	}

	@Override
	public String getTaskName() {
		return taskName;
	}

	public void setTaskName(String taskName) {
		this.taskName = taskName;
	}

	@Override
	public List<Path> getTargetPath() {
		return targetPath;
	}

	public void setTargetPath(List<Path> targetPath) {
		this.targetPath = targetPath;
	}

	@Override
	public Path getOutputPath() {
		return outputPath;
	}

	public void setOutputPath(Path outputPath) {
		this.outputPath = outputPath;
	}

	@Override
	public List<String> getRules() {
		return rules;
	}

	public void setRules(List<String> rules) {
		this.rules = rules;
	}

	@Override
	public IPropagationTransform getPropagationTransform() {
		return propagationTransform;
	}

	public void setPropagationTransform(IPropagationTransform propagationTransform) {
		this.propagationTransform = propagationTransform;
	}

	@Override
	public Set<IRule> getRegisterRules() {
		return registerRules;
	}

	public void setRegisterRules(Set<IRule> registerRules) {
		this.registerRules = registerRules;
	}

	@Override
	public Set<Path> getTargetAllFilePath() {
		return targetAllFilePath;
	}

	public void setTargetAllFilePath(Set<Path> targetAllFilePath) {
		this.targetAllFilePath = targetAllFilePath;
	}

	public CheckConfig getCheckConfig() {
		return checkConfig;
	}

	public void setCheckConfig(CheckConfig checkConfig) {
		this.checkConfig = checkConfig;
	}

	@Override
	public long getCheckerTimeout() {
		return checkerTimeout;
	}

	public void setCheckerTimeout(long checkerTimeout) {
		this.checkerTimeout = checkerTimeout;
	}

	@Override
	public JavaFrameworkSupport getJavaFrameworkSupport() {
		return javaFrameworkSupport;
	}

	public void setJavaFrameworkSupport(JavaFrameworkSupport javaFrameworkSupport) {
		this.javaFrameworkSupport = javaFrameworkSupport;
	}

	@Override
	public SourceFileConfig getSourceFileConfig() {
		return sourceFileConfig;
	}

	public void setSourceFileConfig(SourceFileConfig sourceFileConfig) {
		this.sourceFileConfig = sourceFileConfig;
	}

	@Override
	public String toString() {
		return new StringJoiner(", ", DefaultContext.class.getSimpleName() + "[", "]")
			.add("taskName='" + taskName + "'")
			.add("targetPath=" + targetPath)
			.add("outputPath=" + outputPath)
			.add("rules=" + rules)
			.add("propagationTransform=" + propagationTransform)
			.add("registerRules=" + registerRules)
			.add("targetAllFilePath=" + targetAllFilePath)
			.add("checkConfig=" + checkConfig)
			.add("checkerTimeout=" + checkerTimeout)
			.add("javaFrameworkSupport=" + javaFrameworkSupport)
			.add("sourceFileConfig=" + sourceFileConfig)
			.toString();
	}
}

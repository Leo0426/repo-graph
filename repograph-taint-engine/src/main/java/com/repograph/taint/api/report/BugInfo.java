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

package com.repograph.taint.api.report;

import java.util.List;

/**
 * bug info.
 *
 * @author leolu
 * @since 2023/8/9
 */
public interface BugInfo {

	String getBugId();

	String getGroupId();

	String getFilePath();

	int getLine();

	String getMethodName();

	String getVariable();

	String getRuleType();

	String getMessage();

	String getWeaknessLevel();

	List<BugStepInfo> getSteps();

	static Builder builder() {
		return new Builder();
	}

	default Builder toBuilder() {
		return builder()
			.withBugId(getBugId())
			.withGroupId(getGroupId())
			.withFilePath(getFilePath())
			.withLine(getLine())
			.withMethodName(getMethodName())
			.withVariable(getVariable())
			.withRuleType(getRuleType())
			.withMessage(getMessage())
			.withWeaknessLevel(getWeaknessLevel())
			.withSteps(getSteps());
	}

	final class Builder {
		private String bugId;
		private String groupId;
		private String filePath;
		private int line;
		private String methodName;
		private String variable;
		private String ruleType;
		private String message;
		private String weaknessLevel;
		private List<BugStepInfo> steps;

		private Builder() {
		}


		public Builder withBugId(String bugId) {
			this.bugId = bugId;
			return this;
		}

		public Builder withGroupId(String groupId) {
			this.groupId = groupId;
			return this;
		}

		public Builder withFilePath(String filePath) {
			this.filePath = filePath;
			return this;
		}

		public Builder withLine(int line) {
			this.line = line;
			return this;
		}

		public Builder withMethodName(String methodName) {
			this.methodName = methodName;
			return this;
		}

		public Builder withVariable(String variable) {
			this.variable = variable;
			return this;
		}

		public Builder withRuleType(String ruleType) {
			this.ruleType = ruleType;
			return this;
		}

		public Builder withMessage(String message) {
			this.message = message;
			return this;
		}

		public Builder withWeaknessLevel(String weaknessLevel) {
			this.weaknessLevel = weaknessLevel;
			return this;
		}

		public Builder withSteps(List<BugStepInfo> steps) {
			this.steps = steps;
			return this;
		}

		public BugInfoEntity build() {
			BugInfoEntity bugInfoEntity = new BugInfoEntity();
			bugInfoEntity.setBugId(bugId);
			bugInfoEntity.setGroupId(groupId);
			bugInfoEntity.setFilePath(filePath);
			bugInfoEntity.setLine(line);
			bugInfoEntity.setMethodName(methodName);
			bugInfoEntity.setVariable(variable);
			bugInfoEntity.setRuleType(ruleType);
			bugInfoEntity.setMessage(message);
			bugInfoEntity.setWeaknessLevel(weaknessLevel);
			bugInfoEntity.setSteps(steps);
			return bugInfoEntity;
		}
	}
}

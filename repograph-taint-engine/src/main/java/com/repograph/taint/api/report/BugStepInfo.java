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

/**
 * @author leolu
 * @since 2023/8/9
 */
public interface BugStepInfo {

	String getBugId();

	String getFilePath();

	int getLine();

	String getMethodName();

	String getStepMsg();

	String getVariable();

	default Builder toBuilder() {
		return builder()
			.withBugId(getBugId())
			.withLine(getLine())
			.withFilePath(getFilePath())
			.withMethodName(getMethodName())
			.withStepMsg(getStepMsg())
			.withVariable(getVariable());
	}

	static Builder builder() {
		return new Builder();
	}

	final class Builder {
		private String bugId;
		private String filePath;
		private int line;
		private String methodName;
		private String stepMsg;
		private String variable;

		private Builder() {
		}


		public Builder withBugId(String bugId) {
			this.bugId = bugId;
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

		public Builder withStepMsg(String stepMsg) {
			this.stepMsg = stepMsg;
			return this;
		}

		public Builder withVariable(String variable) {
			this.variable = variable;
			return this;
		}

		public BugStepInfoEntity build() {
			BugStepInfoEntity stepInfoEntity = new BugStepInfoEntity();
			stepInfoEntity.setBugId(bugId);
			stepInfoEntity.setFilePath(filePath);
			stepInfoEntity.setLine(line);
			stepInfoEntity.setMethodName(methodName);
			stepInfoEntity.setStepMsg(stepMsg);
			stepInfoEntity.setVariable(variable);
			return stepInfoEntity;
		}
	}
}

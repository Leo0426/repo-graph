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

import com.google.common.base.MoreObjects;

/**
 * @author LeoLu
 * @since 1/6/2022
 **/
public class BugStepInfoEntity implements BugStepInfo {

	private String bugId;

	/**
	 * clazz path.
	 */
	private String filePath;

	/**
	 * bug code line number.
	 */
	private int line;

	/**
	 * bug code local method.
	 */
	private String methodName;

	/**
	 * step message.
	 */
	private String stepMsg;

	/**
	 * taint variable name.
	 */
	private String variable;

	@Override
	public String getBugId() {
		return bugId;
	}

	public void setBugId(String bugId) {
		this.bugId = bugId;
	}

	@Override
	public String getFilePath() {
		return filePath;
	}

	public void setFilePath(String filePath) {
		this.filePath = filePath;
	}

	@Override
	public int getLine() {
		return line;
	}

	public void setLine(int line) {
		this.line = line;
	}

	@Override
	public String getMethodName() {
		return methodName;
	}

	public void setMethodName(String methodName) {
		this.methodName = methodName;
	}

	@Override
	public String getStepMsg() {
		return stepMsg;
	}

	public void setStepMsg(String stepMsg) {
		this.stepMsg = stepMsg;
	}

	@Override
	public String getVariable() {
		return variable;
	}

	public void setVariable(String variable) {
		this.variable = variable;
	}

	@Override
	public String toString() {
		return MoreObjects.toStringHelper(this)
			.add("bugId", bugId)
			.add("filePath", filePath)
			.add("line", line)
			.add("methodName", methodName)
			.add("stepMsg", stepMsg)
			.add("variable", variable)
			.toString();
	}
}

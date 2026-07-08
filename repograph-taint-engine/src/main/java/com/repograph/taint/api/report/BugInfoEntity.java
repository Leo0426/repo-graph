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

import java.util.List;

/**
 * bug info entity.
 *
 * @author leolu
 * @since 2023/8/9
 */
public class BugInfoEntity implements BugInfo {

	/**
	 * one weakness only have one id.
	 * this id calculates by lots of state.
	 */
	private String bugId;

	/**
	 * used by fixed point.
	 */
	private String groupId;

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
	 * taint variable name.
	 */
	private String variable;

	/**
	 * rule type.
	 */
	private String ruleType;

	/**
	 * description of weakness.
	 */
	private String message;

	/**
	 * weaknessLevel
	 */
	private String weaknessLevel;

	/**
	 * steps
	 */
	private List<BugStepInfo> steps;

	@Override
	public String getBugId() {
		return bugId;
	}

	public void setBugId(String bugId) {
		this.bugId = bugId;
	}

	@Override
	public String getGroupId() {
		return groupId;
	}

	public void setGroupId(String groupId) {
		this.groupId = groupId;
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
	public String getVariable() {
		return variable;
	}

	public void setVariable(String variable) {
		this.variable = variable;
	}

	@Override
	public String getRuleType() {
		return ruleType;
	}

	public void setRuleType(String ruleType) {
		this.ruleType = ruleType;
	}

	@Override
	public String getMessage() {
		return message;
	}

	public void setMessage(String message) {
		this.message = message;
	}

	@Override
	public String getWeaknessLevel() {
		return weaknessLevel;
	}

	public void setWeaknessLevel(String weaknessLevel) {
		this.weaknessLevel = weaknessLevel;
	}

	@Override
	public List<BugStepInfo> getSteps() {
		return steps;
	}

	public void setSteps(List<BugStepInfo> steps) {
		this.steps = steps;
	}

	@Override
	public String toString() {
		return MoreObjects.toStringHelper(this)
			.add("bugId", bugId)
			.add("groupId", groupId)
			.add("filePath", filePath)
			.add("line", line)
			.add("methodName", methodName)
			.add("variable", variable)
			.add("ruleType", ruleType)
			.add("message", message)
			.add("weaknessLevel", weaknessLevel)
			.add("steps", steps)
			.toString();
	}


}

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

import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.api.rules.IRule;
import com.ibm.wala.classLoader.IBytecodeMethod;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.ssa.SSAInstruction;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static java.util.Objects.nonNull;

/**
 * method rules.
 *
 * @author leolu
 * @since 2023/10/26
 */
public abstract class AbstractMethodRule implements IRule {

	/**
	 * run analysis on method bytecode.
	 *
	 * @param node node.
	 */
	public abstract void runOnMethod(CGNode node);

	protected BugMateInfo buildBugMateInfo(SSAInstruction inst, CGNode node) {
		int lineNum = 0;
		IMethod method = node.getMethod();
		IMethod.SourcePosition sourcePosition = null;
		if (method instanceof IBytecodeMethod) {
			try {
				sourcePosition = method
					.getSourcePosition(((IBytecodeMethod<?>) method).getBytecodeIndex(inst.iIndex()));
			} catch (InvalidClassFileException ignore) {
			}
		}
		if (nonNull(sourcePosition)) {
			lineNum = sourcePosition.getLastLine();
		}
		return BugMateInfo.builder()
			.withMethod(node.getMethod())
			.withSsaInstruction(inst)
			.withLineNumber(lineNum)
			.withSsaInstruction(inst)
			.withCgNode(node)
			.build();
	}

	protected BugMateInfo buildBugMateInfo(SSAInstruction inst, CGNode node, String variable) {
		return buildBugMateInfo(inst, node).toBuilder()
			.withVariable(variable)
			.build();
	}

	protected BugMateInfo buildBugMateInfo(SSAInstruction inst, CGNode node, String variable, String fieldName) {
		return buildBugMateInfo(inst, node).toBuilder()
			.withFieldName(fieldName)
			.withVariable(variable)
			.build();
	}

	protected BugMateInfo buildBugMateInfo(SSAInstruction inst, CGNode node, String variable,
										   String fieldName, List<String> attributes) {
		return buildBugMateInfo(inst, node).toBuilder()
			.withFieldName(fieldName)
			.withVariable(variable)
			.withAttributes(attributes)
			.build();
	}

	protected BugMateInfo buildBugMateInfo(IMethod method) {
		int lineNum = method.getLineNumber(0);
		return BugMateInfo.builder()
			.withMethod(method)
			.withSignature(method.getSignature())
			.withLineNumber(lineNum)
			.build();
	}

	protected BugMateInfo buildBugMateInfo(IMethod method, String variable) {
		return buildBugMateInfo(method).toBuilder()
			.withVariable(variable)
			.build();
	}

	public Set<BugMateInfo> result = new HashSet<>();

	public Set<BugMateInfo> getResult() {
		return result;
	}
}

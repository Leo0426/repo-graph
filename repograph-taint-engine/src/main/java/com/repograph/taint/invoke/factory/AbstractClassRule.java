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
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IField;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.classLoader.ShrikeClass;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.types.Selector;
import com.ibm.wala.types.TypeName;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static com.repograph.taint.api.report.BugMateInfo.beforeAssemblerName;

public abstract class AbstractClassRule implements IRule {


	/**
	 * run analysis on class bytecode.
	 *
	 * @param clazz clazz
	 */
	public abstract void runOnMethod(IClass clazz);

	protected boolean isImplementsSerializable(IClass clazz) {
		boolean serializableClass = false;
		Atom policyPackage = Atom.findOrCreateAsciiAtom("java/io");
		Atom policyClass = Atom.findOrCreateAsciiAtom("Serializable");
		TypeName policyClassType = TypeName.findOrCreateClass(policyPackage, policyClass);
		if (clazz instanceof ShrikeClass) {
			Collection<IClass> interfaceNames = clazz.getAllImplementedInterfaces();
			for (IClass interfaceName : interfaceNames) {
				if (policyClassType.toString().equals(interfaceName.toString())) {
					serializableClass = true;
					break;
				}
			}
		}
		return serializableClass;
	}

	protected BugMateInfo buildBugMateInfo(int instIndex, IMethod mth, String catchClassString) {
		IMethod.SourcePosition sp = null;
		if (mth instanceof IBytecodeMethod) {
			try {
				sp = mth
					.getSourcePosition(((IBytecodeMethod<?>) mth).getBytecodeIndex(instIndex));
			} catch (InvalidClassFileException ignored) {
			}
		}
		int lineNum = 1;
		if (sp != null) {
			lineNum = sp.getLastLine();
		}
		return BugMateInfo.builder()
			.withMethod(mth)
			.withSignature(catchClassString)
			.withLineNumber(lineNum)
			.build();
	}

	protected BugMateInfo buildBugMateInfo(IMethod mth) {
		int lineNumber = mth.getLineNumber(0);
		return BugMateInfo.builder()
			.withMethod(mth)
			.withLineNumber(lineNumber)
			.withSsaInstruction(null)
			.build();
	}

	protected BugMateInfo buildBugMateInfoForClazz(IClass clazz) {

		IMethod classInitializer = clazz.getMethod(Selector.make("<init>()V"));
		String clazzName = beforeAssemblerName(classInitializer, clazz.getSourceFileName())
			.replace(".java", "");

		return BugMateInfo.builder()
			.withVariable(clazzName)
			.withMethod(classInitializer)
			.withSsaInstruction(null)
			.build();
	}

	protected BugMateInfo buildBugMateInfoForClazz(IClass clazz, List<String> attributes) {
		return buildBugMateInfoForClazz(clazz)
			.toBuilder()
			.withAttributes(attributes)
			.build();
	}

	protected BugMateInfo buildBugMateInfo(IMethod method, int num) {
		return BugMateInfo.builder()
			.withMethod(method)
			.withLineNumber(num)
			.build();
	}

	protected BugMateInfo buildBugMateInfoForField(IField field) {
		String fieldName = field.getName().toString();
		IMethod initMth = field.getDeclaringClass().getDeclaredMethods().iterator().next();
		return BugMateInfo.builder()
			.withMethod(initMth)
			.withVariable(field.getName().toString())
			.withFieldName(fieldName)
			.withSsaInstruction(null)
			.build();
	}

	protected BugMateInfo buildBugMateInfoForField(IField field, String superClass) {
		BugMateInfo metadata = buildBugMateInfoForField(field);
		return metadata.toBuilder()
			.withFieldName(superClass)
			.build();
	}

	public Set<BugMateInfo> result = new HashSet<>();

	public Set<BugMateInfo> getResult() {
		return result;
	}
}

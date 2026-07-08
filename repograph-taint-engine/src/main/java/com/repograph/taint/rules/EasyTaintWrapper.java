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

package com.repograph.taint.rules;

import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.taintWrappers.AbstractEasyTaintWrapper;
import com.repograph.taint.taintWrappers.ITaintPropagationWrapper;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.util.debug.Assertions;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static com.repograph.taint.api.DomainElementType.NORMAL;

public class EasyTaintWrapper extends AbstractEasyTaintWrapper implements ITaintPropagationWrapper<IDomainElement> {
	public EasyTaintWrapper(String f) throws IOException {
		super(new File(f));
	}

	public EasyTaintWrapper(File f) throws IOException {
		super(f);
	}

	@Override
	public List<IDomainElement> getTaintsForMethod(
		BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext, IDomainElement paramIDomainElement) {
		DomainElement domainElement = (DomainElement) paramIDomainElement;
		SSAInstruction sSAInstruction = paramBasicBlockInContext.getDelegate().getInstruction();
		assert sSAInstruction instanceof SSAInvokeInstruction;
		SSAInvokeInstruction sSAInvokeInstruction = (SSAInvokeInstruction) sSAInstruction;
		MethodReference methodReference = sSAInvokeInstruction.getDeclaredTarget();
		AccessPath accessPath = domainElement.getAccessPath();
		if (accessPath.isStatic() || !isSupported(methodReference))
			return Collections.singletonList(domainElement);
		String str1 = methodReference.getSignature();
		String str2 = methodReference.getDeclaringClass().getName().toString();
		if (str2.equals("Ljava/lang/String") && str1.equals("java.lang.String.getChars(II[CI)V"))
			return handleStringGetChars(paramBasicBlockInContext, domainElement);
		List<IDomainElement> arrayList = new ArrayList<>();
		AbstractEasyTaintWrapper.MethodWrapType methodWrapType = getMethodWrapType(methodReference);
		if (methodWrapType == AbstractEasyTaintWrapper.MethodWrapType.KillTaint) {
			if (DFAUtils.containUse(sSAInvokeInstruction, accessPath.getBase())) {
				return Collections.emptyList();
			}
			arrayList.add(domainElement);
		} else if (methodWrapType == AbstractEasyTaintWrapper.MethodWrapType.CreateTaint) {
			arrayList.add(domainElement);
			if (DFAUtils.containUse(sSAInvokeInstruction, accessPath.getBase())) {
				if (sSAInvokeInstruction.hasDef()) {
					AccessPath accessPath1 = new AccessPath(sSAInvokeInstruction.getDef(), null,
						paramBasicBlockInContext.getNode());
					DomainElement domainElement1 = new DomainElement(paramBasicBlockInContext.getNode(), accessPath1,
						domainElement.getSource(), NORMAL, sSAInvokeInstruction, domainElement);
					if (!arrayList.contains(domainElement1)) {
						arrayList.add(domainElement1);
					}
				}
				if (!sSAInvokeInstruction.isStatic()) {
					AccessPath accessPath1 = new AccessPath(sSAInvokeInstruction.getUse(0),
						null, paramBasicBlockInContext.getNode());
					DomainElement domainElement1 = new DomainElement(paramBasicBlockInContext.getNode(),
						accessPath1, domainElement.getSource(), NORMAL,
						sSAInvokeInstruction, domainElement);
					if (!arrayList.contains(domainElement1))
						arrayList.add(domainElement1);
				}
			}
		} else if (methodWrapType == AbstractEasyTaintWrapper.MethodWrapType.Exclude) {
			arrayList.add(domainElement);
		} else {
			Assertions.UNREACHABLE();
		}
		return arrayList;
	}

	@Override
	public boolean isExclusive(BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext) {
		SSAInstruction sSAInstruction = paramBasicBlockInContext.getDelegate().getInstruction();
		return isExclusive(sSAInstruction);
	}

	@Override
	public boolean isExclusive(SSAInstruction paramSSAInstruction) {
		assert paramSSAInstruction instanceof SSAInvokeInstruction;
		MethodReference methodReference = ((SSAInvokeInstruction) paramSSAInstruction).getDeclaredTarget();
		String str1 = methodReference.getSignature();
		String str2 = methodReference.getDeclaringClass().getName().toString();
		if (str2.equals("Ljava/lang/String") && str1.equals("java.lang.String.getChars(II[CI)V"))
			return true;
		AbstractEasyTaintWrapper.MethodWrapType methodWrapType = getMethodWrapType(methodReference);
		return (methodWrapType != AbstractEasyTaintWrapper.MethodWrapType.NotRegistered);
	}

	@Override
	public boolean isKill(BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext, IDomainElement paramT) {
		SSAInstruction sSAInstruction = paramBasicBlockInContext.getDelegate().getInstruction();
		assert sSAInstruction instanceof SSAInvokeInstruction;
		MethodReference methodReference = ((SSAInvokeInstruction) sSAInstruction).getDeclaredTarget();
		AbstractEasyTaintWrapper.MethodWrapType methodWrapType = getMethodWrapType(methodReference);
		return (methodWrapType == AbstractEasyTaintWrapper.MethodWrapType.KillTaint);
	}


	private List<IDomainElement> handleStringGetChars(
		BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext, DomainElement paramDomainElement) {
		AccessPath accessPath = paramDomainElement.getAccessPath();
		List<IDomainElement> arrayList = new ArrayList<>();
		arrayList.add(paramDomainElement);
		if (paramBasicBlockInContext.getDelegate().getInstruction().getUse(0) == accessPath.getBase()) {
			AccessPath accessPath1 = new AccessPath(paramBasicBlockInContext.getDelegate().getInstruction().getUse(3),
				null, paramBasicBlockInContext.getNode());
			arrayList.add(new DomainElement(paramBasicBlockInContext.getNode(), accessPath1,
				paramDomainElement.getSource(), NORMAL,
				paramBasicBlockInContext.getDelegate().getInstruction(),
                    paramDomainElement));
		}
		return arrayList;
	}

}

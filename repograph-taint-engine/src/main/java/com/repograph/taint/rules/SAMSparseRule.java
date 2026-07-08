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

import com.repograph.taint.common.Selectors;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.propagation.SAMPropagationRule;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.util.SparseUtil;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.types.Selector;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

import static com.repograph.taint.api.DomainElementType.NORMAL;


public class SAMSparseRule extends SAMPropagationRule<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> {

	public SAMSparseRule(SolverManager solverManager) {
		super(solverManager);
	}

	public IntSet propagateCallFlow(int value, BasicBlockInContext<IExplodedBasicBlock> t1,
									BasicBlockInContext<IExplodedBasicBlock> t2) {
		MutableSparseIntSet mutableSparseIntSet = MutableSparseIntSet.makeEmpty();

		DomainElement domainElement = (DomainElement) this.domain.getMappedObject(value);
		AccessPath accessPath = domainElement.getAccessPath();

		if (accessPath.isStatic()) {
			mutableSparseIntSet.add(value);
			return mutableSparseIntSet;
		}
		SSAInstruction ssaInstruction = t1.getDelegate().getInstruction();
		if (ssaInstruction instanceof SSAInvokeInstruction ssaInvokeInstruction) {
			MethodReference declaredTarget = ssaInvokeInstruction.getDeclaredTarget();
			Selector selector = t2.getMethod().getSelector();
			if (declaredTarget.getSignature().equals("java.lang.Thread.start()V") && selector.equals(Selectors.SEL_RUN)) {
				CGNode node = t1.getNode();
				DefUse defUse = node.getDU();
				int var = 0;
				Iterator<SSAInstruction> iterator = defUse.getUses(ssaInvokeInstruction.getUse(0));

				while (iterator.hasNext()) {
					SSAInstruction ssaIns = iterator.next();
					if (ssaIns instanceof SSAInvokeInstruction
						&& ((SSAInvokeInstruction) ssaIns).getDeclaredTarget()
						.getSignature().equals("java.lang.Thread.<init>(Ljava/lang/Runnable;)V")) {
						var = ssaIns.getUse(1);
						break;
					}
				}

				if (var == 0) {
					return mutableSparseIntSet;
				}

				if (var == accessPath.getBase()) {
					AccessPath ap = new AccessPath(1, accessPath.cloneFieldRefs(), t2.getNode());
					DomainElement de = new DomainElement(t1.getNode(),
						ap,
						domainElement.getSource(), NORMAL,
						t1.getDelegate().getInstruction(), domainElement);
					mutableSparseIntSet.add(this.domain.add(de));
					return mutableSparseIntSet;
				}

				Set<List<FieldReference>> fields = new HashSet<>();
				if (SparseUtil.matchAccessPaths(t1.getNode(), var, accessPath, fields)) {

					for (List<FieldReference> fieldReferences : fields) {
						AccessPath accessPath1 = new AccessPath(1, fieldReferences, t2.getNode());
						int var1 = this.domain.add(
							new DomainElement(
								t2.getNode(),
								accessPath1,
								domainElement.getSource(), NORMAL,
								t1.getDelegate().getInstruction(), domainElement));
						mutableSparseIntSet.add(var1);
					}
				}
			}
		}
		return mutableSparseIntSet;
	}

	public IntSet propagateCallToReturnFlow(int var1, BasicBlockInContext<IExplodedBasicBlock> var2) {
		MutableSparseIntSet mutableSparseIntSet = MutableSparseIntSet.makeEmpty();
		mutableSparseIntSet.add(var1);
		return mutableSparseIntSet;
	}
}

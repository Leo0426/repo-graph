package com.repograph.taint.propagation;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.common.AliasAnalysis;
import com.repograph.taint.common.Selectors;
import com.repograph.taint.domain.element.*;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.solver.ISolverManager;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.types.Selector;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.Iterator;

public class NullRules extends SAMPropagationRule<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> {

	private final AliasAnalysis aliasAnalysis;

	public NullRules(ISolverManager<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> solverManager) {
		super(solverManager);
		this.aliasAnalysis = new AliasAnalysis(this.pa);
	}

	/**
	 * Propagates taint along a call flow edge between two control flow elements.
	 *
	 * @param paramInt The fact identifier for the taint.
	 * @param var1     The calling control flow element.
	 * @param var2     The called control flow element.
	 * @return A set of propagated taint facts; may be empty if no propagation occurs.
	 */
	@Override
	public IntSet propagateCallFlow(int paramInt, BasicBlockInContext<IExplodedBasicBlock> var1,
									BasicBlockInContext<IExplodedBasicBlock> var2) {

		MutableSparseIntSet mutableSparseIntSet = MutableSparseIntSet.makeEmpty();
		NPDDomainElement npdDomainElement = (NPDDomainElement) this.domain.getMappedObject(paramInt);

		ICodeElement codeElement = npdDomainElement.getCodeElement();
		if (codeElement instanceof StaticFieldElement) {
			mutableSparseIntSet.add(paramInt);
			return mutableSparseIntSet;
		} else {
			if (codeElement instanceof AbsLocalElement absLocalElement) {
				SSAInstruction callInst = var1.getDelegate().getInstruction();
				if (callInst instanceof SSAInvokeInstruction ssaInvokeInstruction) {
					MethodReference methodReference = ssaInvokeInstruction.getDeclaredTarget();
					Selector callSelector = var2.getMethod().getSelector();
					if (methodReference.getSignature().equals("java.lang.Thread.start()V")
						&& callSelector.equals(Selectors.SEL_RUN)) {
						CGNode cgNode = var1.getNode();
						DefUse du = cgNode.getDU();
						int var = 0;
						Iterator<SSAInstruction> uses = du.getUses(callInst.getUse(0));

						while (uses.hasNext()) {
							SSAInstruction instruction = uses.next();
							if (instruction instanceof SSAInvokeInstruction
								&& ((SSAInvokeInstruction) instruction).getDeclaredTarget()
								.getSignature().equals("java.lang.Thread.<init>(Ljava/lang/Runnable;)V")) {
								var = instruction.getUse(1);
								break;
							}
						}

						if (var == 0) {
							return mutableSparseIntSet;
						}

						if (var == absLocalElement.getValueNumber()
							|| this.aliasAnalysis.mayAlias(cgNode, var, absLocalElement.getCGNode(), absLocalElement.getValueNumber())) {
							if (absLocalElement instanceof LocalElement) {
								NPDDomainElement npdLocalElement
									= new NPDDomainElement(var1.getNode(), new LocalElement(1, var2.getNode()),
									npdDomainElement.getSource(), var1.getDelegate().getInstruction(), npdDomainElement);
								mutableSparseIntSet.add(this.domain.add(npdLocalElement));
							} else if (absLocalElement instanceof NormalFieldElement) {
								NPDDomainElement npdNormalFieldElement
									= new NPDDomainElement(var1.getNode(), new NormalFieldElement(1,
									((NormalFieldElement) absLocalElement).getFieldRef(), var2.getNode()),
									npdDomainElement.getSource(), var1.getDelegate().getInstruction(), npdDomainElement);
								mutableSparseIntSet.add(this.domain.add(npdNormalFieldElement));
							}
						}
					}
				}
			}
			return mutableSparseIntSet;
		}
	}

	@Override
	public IntSet propagateCallToReturnFlow(int var1, BasicBlockInContext<IExplodedBasicBlock> var2) {
		MutableSparseIntSet mutableSparseIntSet = MutableSparseIntSet.makeEmpty();
		mutableSparseIntSet.add(var1);
		return mutableSparseIntSet;
	}
}

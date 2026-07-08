

package com.repograph.taint.propagation;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.solver.ISolverManager;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.List;

public class WrapperPropagationRule<F extends IDomainElement, T> extends AbstractTaintPropagationRule<F, T> {

	public WrapperPropagationRule(ISolverManager<F, T> manager) {
		super(manager);
	}

	/*
	 * preliminary condition: canProcess return true.
	 */
	@Override
	public IntSet propagateCallToReturnFlow(int d1, BasicBlockInContext<IExplodedBasicBlock> callSite) {
		MutableSparseIntSet result = MutableSparseIntSet.makeEmpty();
		if (d1 != 0) {
			// Do not apply the taint wrapper to statements that are sources on their own
			if (mSourceSinkGroup != null && mSourceSinkGroup.getSources().contains(callSite)) {
				result.add(d1);
			} else {
				F de = domain.getMappedObject(d1);
				List<F> res = taintWrapper.getTaintsForMethod(callSite, de);
				for (F tempDE : res) {
					result.add(domain.add(tempDE));
				}
			}
		}
		return result;

	}

	/**
	 * preliminary condition: canProcess return true.
	 */
	@Override
	public IntSet propagateCallFlow(int d1, BasicBlockInContext<IExplodedBasicBlock> callsite,
									BasicBlockInContext<IExplodedBasicBlock> dest) {
		assert d1 != 0;
		return MutableSparseIntSet.makeEmpty();
	}

	@Override
	public boolean canProcess(int d1, BasicBlockInContext<IExplodedBasicBlock> callSite) {
		return taintWrapper != null && taintWrapper.isExclusive(callSite);
	}

}

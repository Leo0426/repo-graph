package com.repograph.taint.propagation;

import com.repograph.taint.sourcesink.SourceSinkGroup;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.solver.ISolverManager;
import com.repograph.taint.taintWrappers.ITaintPropagationWrapper;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;


/**
 * Abstract class for taint propagation rules.
 * It defines the basic structure for rules that determine how taint propagates through the program.
 *
 * @param <F> The flow fact type used in the solver.
 * @param <T> The taint fact type used in the solver.
 * @author leo
 * @since 2024/11/18
 */
public abstract class AbstractTaintPropagationRule<F extends IDomainElement, T> implements ITaintPropagationRule {

	/**
	 * Domain of the tabulation solver used for taint propagation.
	 */
	protected TabulationDomain<F, T> domain;

	/**
	 * Wrapper for taint propagation, handling custom propagation logic.
	 */
	protected ITaintPropagationWrapper<F> taintWrapper;

	/**
	 * Group of source and sink definitions used for taint analysis.
	 */
	protected SourceSinkGroup mSourceSinkGroup;

	/**
	 * Pointer analysis object used to resolve pointer-related data flow.
	 */
	protected PointerAnalysis<InstanceKey> pa;

	/**
	 * Constructor for initializing the taint propagation rule.
	 *
	 * @param manager The solver manager providing domain, taint wrapper, source-sink group, and pointer analysis.
	 */
	public AbstractTaintPropagationRule(ISolverManager<F, T> manager) {
		this.domain = manager.getDomain();
		this.taintWrapper = manager.getTaintWrapper();
		this.mSourceSinkGroup = manager.getCurrentSourceSinkGroup();
		this.pa = manager.getPointerAnalysis();
	}
}

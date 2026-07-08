package com.repograph.taint.propagation;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.solver.ISolverManager;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.MethodReference;

import java.util.HashSet;
import java.util.Set;

/**
 * Special Abstract Method Propagation.
 * Abstract class for special taint propagation rules.
 * Checks if a specific method invocation can propagate taints based on predefined signatures.
 *
 * @param <F> The flow fact type used in the solver.
 * @param <T> The taint fact type used in the solver.
 * @author heyonepiece
 * @since 2024/11/18
 */
public abstract class SAMPropagationRule<F extends IDomainElement, T> extends AbstractTaintPropagationRule<F, T> {

	/**
	 * Set of special method signatures for taint propagation.
	 */
	Set<String> specialSignatures = new HashSet<>();

	/**
	 * Constructor to initialize the rule with a solver manager and predefined signatures.
	 *
	 * @param manager the solver manager for managing taint analysis.
	 */
	public SAMPropagationRule(ISolverManager<F, T> manager) {
		super(manager);
		specialSignatures.add("java.lang.Thread.start()V");
	}

	/**
	 * Determines if the rule can process a taint propagation for a given callsite.
	 *
	 * @param d1       the input fact associated with the analysis.
	 * @param callsite the callsite represented by a basic block in context.
	 * @return true if the callsite matches the predefined signatures, false otherwise.
	 */
	@Override
	public boolean canProcess(int d1, BasicBlockInContext<IExplodedBasicBlock> callsite) {
		SSAInstruction instruction = callsite.getDelegate().getInstruction();
		if (instruction instanceof SSAInvokeInstruction invoke) {
			MethodReference targetM = invoke.getDeclaredTarget();
			return specialSignatures.contains(targetM.getSignature());
		}
		return false;
	}
}

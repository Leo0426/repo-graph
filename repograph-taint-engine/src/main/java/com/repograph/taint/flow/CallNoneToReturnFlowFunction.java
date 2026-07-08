package com.repograph.taint.flow;

import com.repograph.taint.api.IContext;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.Engine;
import com.repograph.taint.common.StaticFieldAnalysis;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.flow.sparse.util.SparseTaintUtil;
import com.repograph.taint.flow.vistor.NormalFlowFunctionVisitor;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.Set;

import static com.repograph.taint.api.DomainElementType.NORMAL;

public class CallNoneToReturnFlowFunction implements IUnaryFlowFunction {

	private final PropagationRuleManager propagationRuleManager;

	private final BasicBlockInContext<IExplodedBasicBlock> src;

	private final BasicBlockInContext<IExplodedBasicBlock> dest;

	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;

	private final SolverManager solverManager;

	private final IContext context = GlobalCache.INSTANCE.getDefault();

	/**
	 * Constructor for InvokeFlowFunction.
	 *
	 * @param solverManager          The solver manager that manages the taint analysis process.
	 * @param propagationRuleManager The manager responsible for handling propagation rules.
	 * @param src                    The source basic block in the context of a method.
	 * @param dest                   The target basic block in the context of a method.
	 */
	public CallNoneToReturnFlowFunction(SolverManager solverManager, PropagationRuleManager propagationRuleManager,
										BasicBlockInContext<IExplodedBasicBlock> src, BasicBlockInContext<IExplodedBasicBlock> dest) {
		this.solverManager = solverManager;
		this.src = src;
		this.dest = dest;
		this.propagationRuleManager = propagationRuleManager;
		this.domain = solverManager.getDomain();
	}

	/**
	 * Generates the target IntSet based on the analysis of the source block and its instructions.
	 *
	 * @param d1 The index of the fact being processed.
	 * @return An IntSet representing the targets derived from the source block.
	 */
	@Override
	public IntSet getTargets(int d1) {
		MutableSparseIntSet targetSet = MutableSparseIntSet.makeEmpty();

		if (d1 == 0) {
			handleInitialFact(targetSet);
		} else {
			handleFactPropagation(d1, targetSet);
		}

		return targetSet;
	}

	/**
	 * Handles the propagation for the initial fact (usually representing an initial taint source).
	 *
	 * @param targetSet The set where the results will be stored.
	 */
	private void handleInitialFact(MutableSparseIntSet targetSet) {
		if (!context.getCheckConfig().isUnbalancedOn()) {
			targetSet.add(0);
		}

		if (!context.getRule().getCurrentRuleName().equals("SUMMARY") && solverManager.getSources().contains(this.src)) {
			Set<Integer> sourceIndices = solverManager.getSourceSinkManager()
				.getSourceParaIdx(solverManager.getClassHierarchy(), ((SSAInvokeInstruction) this.src.getDelegate().getInstruction()).getDeclaredTarget());

			if (sourceIndices != null) {
				for (int index : sourceIndices) {
					if (index == -1) {
						int newFactIndex = SparseTaintUtil.createReturnDomainElement(this.domain, this.src);
						targetSet.add(newFactIndex);
						break;
					}
				}
			}
		}
	}

	/**
	 * Handles the propagation of taint information through method invocations.
	 *
	 * @param d1  The index of the fact being processed.
	 * @param targetSet The set where the results will be stored.
	 */
	private void handleFactPropagation(int d1, MutableSparseIntSet targetSet) {

		NormalFlowFunctionVisitor normalFlowFunctionVisitor = new NormalFlowFunctionVisitor(solverManager, d1, src, dest);

		MutableSparseIntSet results = Engine.evaluateBeforeCoreInst(src, d1, normalFlowFunctionVisitor);

		if (propagationRuleManager.canProcess(d1, src)) {
			propagateThroughCall(results, targetSet);
		} else {
			propagateDirectly(results, targetSet);
		}
	}

	/**
	 * Checks if a static field represented by the access path is used in the call graph.
	 *
	 * @param accessPath The access path representing the static field.
	 * @return True if the static field is used, otherwise false.
	 */
	private boolean isStaticFieldUsed(AccessPath accessPath) {
		boolean isUsed = false;
		SSAInvokeInstruction invokeInstruction
			= (SSAInvokeInstruction) src.getDelegate().getInstruction();

		for (CGNode targetNode : solverManager.getCallgraph()
			.getPossibleTargets(src.getNode(), invokeInstruction.getCallSite())) {
			if (StaticFieldAnalysis.getInstance()
				.isStaticFieldUsed(solverManager.getCallgraph(), targetNode, accessPath.getFirstField())) {
				isUsed = true;
				break;
			}
		}

		return isUsed;
	}

	/**
	 * Propagates the taint through the method invocation.
	 *
	 * @param results   The set of intermediate results from evaluating core instructions.
	 * @param targetSet The set where the final results will be stored.
	 */
	private void propagateThroughCall(MutableSparseIntSet results, MutableSparseIntSet targetSet) {
		IntIterator iterator = results.intIterator();
		while (iterator.hasNext()) {
			int result = iterator.next();
			IntSet propagatedSet = propagationRuleManager.applyCallToReturnFlowFunction(result, src);
			if (!propagatedSet.isEmpty()) {
				targetSet.addAll(propagatedSet);
			}
		}
	}

	/**
	 * Directly propagates the taint to the target set based on the last instruction in the source block.
	 *
	 * @param results   The set of intermediate results from evaluating core instructions.
	 * @param targetSet The set where the final results will be stored.
	 */
	private void propagateDirectly(MutableSparseIntSet results, MutableSparseIntSet targetSet) {
		targetSet.addAll(results);

		SSAInstruction lastInstruction = this.src.getLastInstruction();
		if (lastInstruction instanceof SSAInvokeInstruction invokeInstruction) {
			if (lastInstruction.hasDef() || !invokeInstruction.isStatic()) {
				propagateToDefinedOrUsedVariables(results, invokeInstruction, targetSet);
			}
		}


	}

	/**
	 * Propagates the taint to variables that are defined or used in the invoke instruction.
	 *
	 * @param results           The set of intermediate results from evaluating core instructions.
	 * @param invokeInstruction The invoke instruction being analyzed.
	 * @param targetSet         The set where the final results will be stored.
	 */
	private void propagateToDefinedOrUsedVariables(MutableSparseIntSet results,
												   SSAInvokeInstruction invokeInstruction,
												   MutableSparseIntSet targetSet) {
		IntIterator iterator = results.intIterator();
		while (iterator.hasNext()) {
			int result = iterator.next();
			DomainElement domainElement = (DomainElement) domain.getMappedObject(result);
			AccessPath accessPath = domainElement.getAccessPath();

			if (!accessPath.isStatic() && !domainElement.isExceptionType() && !domainElement.isReturnType()) {
				int base = accessPath.getBase();
				if (DFAUtils.containUse(invokeInstruction, base)) {
					if (invokeInstruction.hasDef()) {
						AccessPath newPath = new AccessPath(invokeInstruction.getDef(), null, src.getNode());
						targetSet.add(domain.add(new DomainElement(src.getNode(),
							newPath, domainElement.getSource(), NORMAL,
							this.src.getDelegate().getInstruction(), domainElement)));
					}
					if (!invokeInstruction.isStatic()) {
						AccessPath newPath = new AccessPath(invokeInstruction.getUse(0), null, src.getNode());
						targetSet.add(domain.add(new DomainElement(src.getNode(), newPath,
							domainElement.getSource(), NORMAL, this.src.getDelegate().getInstruction(), domainElement)));
					}
				}
			}
		}
	}
}

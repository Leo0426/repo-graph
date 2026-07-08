package com.repograph.taint.npdnorm.ifds.flow;

import com.repograph.taint.common.CallSiteFinder;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.ICodeElement;
import com.repograph.taint.domain.element.AbsLocalElement;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.domain.element.ReturnElement;
import com.repograph.taint.domain.element.StaticFieldElement;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import com.ibm.wala.util.intset.SparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.ExecutionException;

public class NPDUnbalanceFlowFunction implements IUnaryFlowFunction {

	private final Logger logger = LoggerFactory.getLogger(NPDUnbalanceFlowFunction.class);
	private final SolverManager solverManager;
	private final PropagationRuleManager ruleManager;
	private final BasicBlockInContext<IExplodedBasicBlock> currentBlock;
	private final BasicBlockInContext<IExplodedBasicBlock> targetBlock;
	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;
	private final ICFGSupergraph superGraph;

	/**
	 * Constructor for NullPointerFlowFunction.
	 *
	 * @param solverManager The manager for solving analysis.
	 * @param ruleManager   The manager for propagation rules.
	 * @param currentBlock  The current basic block in context.
	 * @param targetBlock   The target basic block in context.
	 */
	public NPDUnbalanceFlowFunction(SolverManager solverManager,
									PropagationRuleManager ruleManager,
									BasicBlockInContext<IExplodedBasicBlock> currentBlock,
									BasicBlockInContext<IExplodedBasicBlock> targetBlock) {
		this.solverManager = solverManager;
		this.ruleManager = ruleManager;
		this.superGraph = (ICFGSupergraph) solverManager.getICFGSuperGraph();
		this.domain = solverManager.getDomain();
		this.currentBlock = currentBlock;
		this.targetBlock = targetBlock;

		// Ensure the current block is an exit block.
		assert currentBlock.isExitBlock();
	}

	@Override
	public IntSet getTargets(int inputIndex) {
		// Handle default case where inputIndex is 0
		if (inputIndex == 0) {
			return new SparseIntSet();
		}

		// Debug log before processing
		DFAUtils.dumpFactInfoBeforeProcessing(domain, currentBlock, inputIndex, logger);

		MutableSparseIntSet targetSet = MutableSparseIntSet.makeEmpty();
		NPDDomainElement NPDDomainElement = (NPDDomainElement) domain.getMappedObject(inputIndex);

		// Process all call sites related to the current and target block
		try {
			CallSiteFinder.getInstance(superGraph)
				.getAllCallSite(currentBlock, targetBlock, NPDDomainElement)
				.stream()
				.filter(callSite
					-> callSite.getNode().equals(targetBlock.getNode()))
				.forEach(
					callSite -> {
						// Validate the instruction and domain element
						if (isInstructionRelevant(callSite.getDelegate().getInstruction(), NPDDomainElement)) {
							// Add all targets from a new flow function instance
							targetSet.addAll(new NullPointReturnFlowFunction(solverManager, ruleManager, callSite, currentBlock, targetBlock)
								.getTargets(inputIndex));
						}
					});
		} catch (ExecutionException e) {
			throw new RuntimeException(e);
		}

		// Debug log after processing
		if (logger.isDebugEnabled()) {
			DFAUtils.dumpFactsInfoAfterProcessing(domain, currentBlock, targetSet, logger);
		}

		return targetSet;
	}

	/**
	 * Validates whether the given instruction and domain element are relevant for analysis.
	 *
	 * @param instruction      The instruction to validate.
	 * @param NPDDomainElement The domain element to validate against.
	 * @return True if relevant, otherwise false.
	 */
	private boolean isInstructionRelevant(SSAInstruction instruction, NPDDomainElement NPDDomainElement) {
		// Ensure the instruction is an SSAInvokeInstruction
		assert instruction instanceof SSAInvokeInstruction;

		SSAInvokeInstruction invokeInstruction = (SSAInvokeInstruction) instruction;
		ICodeElement codeElement = NPDDomainElement.getCodeElement();

		// Exception type or static field elements are always relevant
		if (NPDDomainElement.isExceptionType() || codeElement instanceof StaticFieldElement) {
			return true;
		}

		IClass targetClass = null;

		// Determine the declaring class of the code element
		if (codeElement instanceof AbsLocalElement) {
			targetClass = codeElement.getCGNode().getMethod().getDeclaringClass();
		} else if (codeElement instanceof ReturnElement) {
			targetClass = codeElement.getCGNode().getMethod().getDeclaringClass();
		}

		// Check if the declared target class is assignable to the domain element's class
		IClassHierarchy classHierarchy = solverManager.getClassHierarchy();
		return classHierarchy.isAssignableFrom(classHierarchy.lookupClass(invokeInstruction
			.getDeclaredTarget().getDeclaringClass()), targetClass);
	}
}

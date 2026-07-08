package com.repograph.taint.npdnorm.ifds.flow;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolverManager;
import com.repograph.taint.npdnorm.ifds.visitor.NullPointerInstructionVisitor;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAArrayLengthInstruction;
import com.ibm.wala.ssa.SSAConditionalBranchInstruction;
import com.ibm.wala.ssa.SSAGetInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import com.ibm.wala.util.intset.SparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import static com.repograph.taint.Engine.evaluateAfterCoreInst;
import static com.repograph.taint.Engine.evaluateBeforeCoreInst;


public class NullPointFlowFunction implements IUnaryFlowFunction {

	private static final int DEFAULT_VAR_ID = 0;

	private static final Logger LOGGER = LoggerFactory.getLogger(NullPointFlowFunction.class);

	private final BasicBlockInContext<IExplodedBasicBlock> sourceBlock;
	private final BasicBlockInContext<IExplodedBasicBlock> targetBlock;
	private final NPDSolverManager nullPointerManager;
	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;

	/**
	 * Constructor for NullPointerFlowFunction.
	 *
	 * @param solverManager The solver manager handling null pointer analysis.
	 * @param ruleManager   The propagation rule manager.
	 * @param sourceBlock   The source block in the control flow graph.
	 * @param targetBlock   The target block in the control flow graph.
	 */
	public NullPointFlowFunction(SolverManager solverManager,
								 PropagationRuleManager ruleManager,
								 BasicBlockInContext<IExplodedBasicBlock> sourceBlock,
								 BasicBlockInContext<IExplodedBasicBlock> targetBlock) {
		this.nullPointerManager = (NPDSolverManager) solverManager;
		this.domain = solverManager.getDomain();
		this.sourceBlock = sourceBlock;
		this.targetBlock = targetBlock;
	}

	@Override
	public IntSet getTargets(int factId) {
		return evaluateTargets(sourceBlock, factId);
	}

	/**
	 * Evaluate the targets for null pointer propagation based on the control flow block and fact ID.
	 *
	 * @param block  The control flow block.
	 * @param factId The fact ID associated with null pointer analysis.
	 * @return A set of target facts after propagation.
	 */
	private IntSet evaluateTargets(BasicBlockInContext<IExplodedBasicBlock> block, int factId) {
		NullPointerInstructionVisitor visitor
			= new NullPointerInstructionVisitor(nullPointerManager, factId, sourceBlock, targetBlock);

		MutableSparseIntSet preInstructionFacts = evaluateBeforeCoreInst(block, factId, visitor);

		SSAInstruction lastInstruction = block.getLastInstruction();
		MutableSparseIntSet intermediateFacts = MutableSparseIntSet.makeEmpty();

		if (lastInstruction != null) {
			if (!(lastInstruction instanceof SSAConditionalBranchInstruction)
				&& !(lastInstruction instanceof SSAGetInstruction)
				&& !(lastInstruction instanceof SSAArrayLengthInstruction)
				&& factId == DEFAULT_VAR_ID) {
				return SparseIntSet.singleton(0);
			}

			IntIterator iterator = preInstructionFacts.intIterator();
			while (iterator.hasNext()) {
				int fact = iterator.next();
				visitor = new NullPointerInstructionVisitor(nullPointerManager, fact, sourceBlock, targetBlock);
				lastInstruction.visit(visitor);
				intermediateFacts.addAll(visitor.getIntSet());
			}
		} else {
			intermediateFacts.addAll(preInstructionFacts);
		}

		MutableSparseIntSet finalFacts = MutableSparseIntSet.makeEmpty();
		IntIterator intermediateIterator = intermediateFacts.intIterator();

		while (intermediateIterator.hasNext()) {
			int intermediateFact = intermediateIterator.next();
			visitor = new NullPointerInstructionVisitor(nullPointerManager, intermediateFact, sourceBlock, targetBlock);
			IntSet postInstructionFacts = evaluateAfterCoreInst(block, intermediateFact, visitor);
			finalFacts.addAll(postInstructionFacts);
		}

		return finalFacts;
	}
}

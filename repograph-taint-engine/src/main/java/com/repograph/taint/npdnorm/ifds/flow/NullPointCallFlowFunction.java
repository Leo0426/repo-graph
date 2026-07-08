package com.repograph.taint.npdnorm.ifds.flow;

import com.repograph.taint.sourcesink.KillManager;
import com.repograph.taint.sourcesink.KillParameterDefinition;
import com.repograph.taint.common.StaticFieldAnalysis;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolverManager;
import com.repograph.taint.npdnorm.ifds.NullPointerDeferenceDomain;
import com.repograph.taint.domain.element.LocalElement;
import com.repograph.taint.domain.element.StaticFieldElement;
import com.repograph.taint.npdnorm.ifds.visitor.NullPointerInstructionVisitor;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.*;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import static com.repograph.taint.Engine.evaluateBeforeCoreInst;

public class NullPointCallFlowFunction implements IUnaryFlowFunction {

	private static final int DEFAULT_FACT_ID = 0;

	private final BasicBlockInContext<IExplodedBasicBlock> sourceBlock;
	private final BasicBlockInContext<IExplodedBasicBlock> targetBlock;
	private final PropagationRuleManager ruleManager;
	private final NullPointerDeferenceDomain<IDomainElement> nullPointerDomain;
	private final NPDSolverManager npdSolverManager;
	private final SSAInvokeInstruction invokeInstruction;
	private final KillManager killManager;
	private final CGNode cgNode;

	/**
	 * Constructor for CallFlowFunction.
	 *
	 * @param solverManager The solver manager responsible for analysis components.
	 * @param ruleManager   The rule manager for applying propagation rules.
	 * @param sourceBlock   The source block in the CFG.
	 * @param targetBlock   The target block in the CFG.
	 */
	public NullPointCallFlowFunction(SolverManager solverManager,
									 PropagationRuleManager ruleManager,
									 BasicBlockInContext<IExplodedBasicBlock> sourceBlock,
									 BasicBlockInContext<IExplodedBasicBlock> targetBlock) {
		this.ruleManager = ruleManager;
		this.npdSolverManager = (NPDSolverManager) solverManager;
		this.nullPointerDomain = (NullPointerDeferenceDomain<IDomainElement>) solverManager.getDomain();
		this.killManager = solverManager.getKillManager();
		this.sourceBlock = sourceBlock;
		this.targetBlock = targetBlock;

		SSAInstruction instruction = sourceBlock.getDelegate().getInstruction();
		if (!(instruction instanceof SSAInvokeInstruction)) {
			throw new IllegalStateException("Expected an SSAInvokeInstruction.");
		}

		this.invokeInstruction = (SSAInvokeInstruction) instruction;
		Map<Object, Set<Object>> argumentMapping = new HashMap<>();

		int numberOfArguments = invokeInstruction.getNumberOfUses();
		for (int i = 0; i < numberOfArguments; i++) {
			DFAUtils.putElementToMap(argumentMapping, invokeInstruction.getUse(i), i + 1);
		}

		this.cgNode = sourceBlock.getNode();

		if (!targetBlock.isEntryBlock()) {
			throw new IllegalStateException("Expected the target block to be an entry block.");
		}
	}

	@Override
	public IntSet getTargets(int factId) {
		this.npdSolverManager.addBBVisited(targetBlock.getNode(), targetBlock);

		if (sourceBlock.getNode().getIR().getMethod().getDeclaringClass().getClassLoader().getReference()
			.equals(ClassLoaderReference.Application)) {
			processReturnValuesFromTargetBlock();
		}

		MutableSparseIntSet resultSet = MutableSparseIntSet.makeEmpty();
		if (isKilledFact(factId)) {
			return resultSet;
		}

		if (factId == DEFAULT_FACT_ID) {
			resultSet.add(DEFAULT_FACT_ID);
		} else {
			processFlowFacts(factId, resultSet);
		}

		return resultSet;
	}

	private void processReturnValuesFromTargetBlock() {
		CGNode targetNode = targetBlock.getNode();
		SymbolTable symbolTable = targetNode.getIR().getSymbolTable();
		SSAInstruction lastInstruction = sourceBlock.getLastInstruction();

		if (!(lastInstruction instanceof SSAInvokeInstruction invoke)) {
			throw new IllegalStateException("Expected an SSAInvokeInstruction.");
		}

		if (invoke.getNumberOfReturnValues() > 0) {
			int totalBooleanReturns = 0;
			int trueReturns = 0;
			int falseReturns = 0;

			IR ir = targetNode.getIR();
			SSAInstruction[] instructions = ir.getInstructions();
			for (SSAInstruction instruction : instructions) {
				if (instruction instanceof SSAReturnInstruction returnInstruction) {
					int resultValue = returnInstruction.getResult();
					if (resultValue > 0 && symbolTable.isBooleanOrZeroOneConstant(resultValue)) {
						totalBooleanReturns++;
						if (symbolTable.isOneOrTrue(resultValue)) {
							trueReturns++;
						}
						if (symbolTable.isZeroOrFalse(resultValue)) {
							falseReturns++;
						}
					}
				}
			}

			if (totalBooleanReturns > 0 && lastInstruction.getDef() > 0) {
				if (totalBooleanReturns == trueReturns) {
					npdSolverManager.isMethodRetTRUEorFALSE(new LocalElement(lastInstruction.getDef(), cgNode));
				}
				if (totalBooleanReturns == falseReturns) {
					npdSolverManager.isMethodRetTRUEorFALSE(new LocalElement(lastInstruction.getDef(), cgNode));
				}
			}
		}
	}

	// void exampleMethod() {
	//    Object obj = null; // SSA 值编号为 1
	//    // 未对 obj 进行赋值
	//}
	// 过滤无意义或默认初始值,提高分析的准确性和效率,减少误报
	private boolean isKilledFact(int factId) {
		NPDDomainElement npdDomainElement = (NPDDomainElement) nullPointerDomain.getMappedObject(factId);
		if (npdDomainElement.getCodeElement() instanceof LocalElement localElement) {
			return cgNode.equals(localElement.getCGNode()) && localElement.getValueNumber() == 1;
		}
		return false;
	}

	private void processFlowFacts(int factId, MutableSparseIntSet resultSet) {
		NPDDomainElement npdDomainElement = (NPDDomainElement) nullPointerDomain.getMappedObject(factId);

		if (npdDomainElement.getCodeElement() instanceof StaticFieldElement staticFieldElement
			&& !StaticFieldAnalysis.getInstance().isStaticFieldUsed(npdSolverManager.getCallgraph(), targetBlock.getNode(), staticFieldElement.getFieldRef())) {
			return;
		}

		if (killManager.getKilledParam().containsKey(invokeInstruction.getCallSite().getDeclaredTarget().getSignature())) {
			if (shouldKillFact(factId, npdDomainElement)) {
				return;
			}
		}
		NullPointerInstructionVisitor nullPointerInstructionVisitor = new NullPointerInstructionVisitor(npdSolverManager, factId, sourceBlock, targetBlock);

		MutableSparseIntSet intermediateSet = evaluateBeforeCoreInst(sourceBlock, factId, nullPointerInstructionVisitor);
		applyPropagationRules(factId, resultSet, intermediateSet);
	}

	private boolean shouldKillFact(int factId, NPDDomainElement npdDomainElement) {
		for (int i = 0; i < invokeInstruction.getNumberOfUses(); i++) {
			if (!invokeInstruction.isStatic() && i == 0) {
				continue;
			}
			LocalElement localElement = new LocalElement(invokeInstruction.getUse(i), cgNode);
			NPDDomainElement potentialMatch = new NPDDomainElement(cgNode, localElement, npdDomainElement.getSource(), invokeInstruction, npdDomainElement);
			if (nullPointerDomain.hasMappedIndex(potentialMatch)) {
				int mappedIndex = nullPointerDomain.getMappedIndex(potentialMatch);
				if (mappedIndex == factId) {
					int adjustedIndex = invokeInstruction.isStatic() ? i : i - 1;
					if (killManager.needKillParam(new KillParameterDefinition(invokeInstruction.getDeclaredTarget().getSignature(), adjustedIndex))) {
						return true;
					}
				}
			}
		}
		return false;
	}

	private void applyPropagationRules(int factId, MutableSparseIntSet resultSet, MutableSparseIntSet intermediateSet) {
		if (ruleManager.canProcess(factId, sourceBlock)) {
			for (IntIterator it = intermediateSet.intIterator(); it.hasNext(); ) {
				int fact = it.next();
				IntSet propagatedFacts = ruleManager.applyCallFlowFunction(fact, sourceBlock, targetBlock);
				resultSet.addAll(propagatedFacts);
			}
		} else {
			resultSet.addAll(intermediateSet);
		}
	}
}

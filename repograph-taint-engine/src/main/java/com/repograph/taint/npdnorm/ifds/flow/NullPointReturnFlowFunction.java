package com.repograph.taint.npdnorm.ifds.flow;

import com.repograph.taint.sourcesink.KillManager;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.common.AliasAnalysis;
import com.repograph.taint.common.Selectors;
import com.repograph.taint.domain.element.ExceptionElement;
import com.repograph.taint.domain.element.ICodeElement;
import com.repograph.taint.domain.element.LocalElement;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.domain.element.NormalFieldElement;
import com.repograph.taint.domain.element.ReturnElement;
import com.repograph.taint.domain.element.ReturnFieldElement;
import com.repograph.taint.domain.element.StaticFieldElement;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolverManager;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAGetCaughtExceptionInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import com.ibm.wala.util.intset.SparseIntSet;

import java.util.HashMap;
import java.util.Map;

public class NullPointReturnFlowFunction implements IUnaryFlowFunction {

	private static final int DEFAULT_FACT_ID = 0;

	private final BasicBlockInContext<IExplodedBasicBlock> sourceBlock;
	private final BasicBlockInContext<IExplodedBasicBlock> targetBlock;
	private final BasicBlockInContext<IExplodedBasicBlock> handlerBlock;
	private final Map<Integer, Integer> argumentMapping;
	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;
	private final PointerAnalysis<InstanceKey> pointerAnalysis;
	private final CGNode targetNode;
	private final SSAInvokeInstruction invokeInstruction;
	private final KillManager killManager;
	private final NPDSolverManager npdSolverManager;

	/**
	 * Constructor for MethodReturnFlowFunction.
	 *
	 * @param solverManager The solver manager for analysis components.
	 * @param ruleManager   The rule manager for propagation rules.
	 * @param sourceBlock   The source block in the CFG.
	 * @param targetBlock   The target block in the CFG.
	 * @param handlerBlock  The handler block for exceptions.
	 */
	public NullPointReturnFlowFunction(SolverManager solverManager, PropagationRuleManager ruleManager,
									   BasicBlockInContext<IExplodedBasicBlock> sourceBlock,
									   BasicBlockInContext<IExplodedBasicBlock> targetBlock,
									   BasicBlockInContext<IExplodedBasicBlock> handlerBlock) {
		this.npdSolverManager = (NPDSolverManager) solverManager;
		this.pointerAnalysis = solverManager.getPointerAnalysis();
		this.domain = solverManager.getDomain();
		this.killManager = solverManager.getKillManager();
		this.sourceBlock = sourceBlock;
		this.targetBlock = targetBlock;
		this.targetNode = targetBlock.getNode();
		this.handlerBlock = handlerBlock;

		SSAInstruction lastInstruction = sourceBlock.getLastInstruction();
		if (!(lastInstruction instanceof SSAInvokeInstruction)) {
			throw new IllegalStateException("Expected an SSAInvokeInstruction.");
		}
		this.invokeInstruction = (SSAInvokeInstruction) lastInstruction;

		this.argumentMapping = new HashMap<>();
		int numParameters = targetNode.getMethod().getNumberOfParameters();
		int numUses = invokeInstruction.getNumberOfUses();

		for (int i = 0; i < numParameters; i++) {
			if (i < numUses) {
				this.argumentMapping.put(i + 1, invokeInstruction.getUse(i));
			}
		}
	}

	@Override
	public IntSet getTargets(int factId) {
		if (factId == DEFAULT_FACT_ID) {
			return SparseIntSet.singleton(0);
		}

		npdSolverManager.addBBVisited(handlerBlock.getNode(), handlerBlock);
		MutableSparseIntSet result = MutableSparseIntSet.makeEmpty();
		NPDDomainElement NPDDomainElement = (NPDDomainElement) domain.getMappedObject(factId);
		ICodeElement codeElement = NPDDomainElement.getCodeElement();
		AliasAnalysis aliasAnalysis = new AliasAnalysis(pointerAnalysis);

		if (codeElement instanceof StaticFieldElement) {
			result.add(factId);
		} else if (codeElement instanceof NormalFieldElement normalFieldElement) {
			processNormalFieldElement(normalFieldElement, NPDDomainElement, aliasAnalysis, result);
		} else if (codeElement instanceof ReturnElement) {
			processReturnElement(NPDDomainElement, result);
		} else if (codeElement instanceof ReturnFieldElement returnFieldElement) {
			processReturnFieldElement(returnFieldElement, NPDDomainElement, result);
		} else if (codeElement instanceof ExceptionElement) {
			processExceptionElement(NPDDomainElement, result);
		}

		return result;
	}

	private void processNormalFieldElement(NormalFieldElement fieldElement, NPDDomainElement NPDDomainElement,
										   AliasAnalysis aliasAnalysis, MutableSparseIntSet result) {
		LocalElement localElement = new LocalElement(fieldElement.getValueNumber(), fieldElement.getCGNode());

		for (Map.Entry<Integer, Integer> entry : argumentMapping.entrySet()) {
			Integer argIndex = entry.getKey();
			if (argIndex == localElement.getValueNumber() ||
				aliasAnalysis.mayAlias(targetNode, argIndex, targetNode, localElement.getValueNumber())) {
				int mappedValue = entry.getValue();
				if (Selectors.isSpecialEdge(invokeInstruction.getDeclaredTarget().getSelector(),
					targetBlock.getMethod().getSelector()) && argIndex == 1) {
					mappedValue = invokeInstruction.isStatic() ? invokeInstruction.getUse(0) : invokeInstruction.getUse(1);
				}

				NormalFieldElement newFieldElement = new NormalFieldElement(mappedValue, fieldElement.getFieldRef(), sourceBlock.getNode());
				int newFactId = domain.add(new NPDDomainElement(sourceBlock.getNode(), newFieldElement,
					NPDDomainElement.getSource(),
					sourceBlock.getDelegate().getInstruction(),
					NPDDomainElement));
				result.add(newFactId);
			}
		}
	}

	private void processReturnElement(NPDDomainElement NPDDomainElement, MutableSparseIntSet result) {
		if (!killManager.needKillReturnValue(targetNode.getMethod().getSignature())) {
			SSAInstruction lastInstruction = sourceBlock.getLastInstruction();
			if (!(lastInstruction instanceof SSAInvokeInstruction invokeInstruction)) {
				throw new IllegalStateException("Expected an SSAInvokeInstruction.");
			}

			if (invokeInstruction.getNumberOfReturnValues() > 0 && !handlerBlock.isCatchBlock()) {
				int returnValue = invokeInstruction.getDef();
				LocalElement returnElement = new LocalElement(returnValue, sourceBlock.getNode());
				int newFactId = domain.add(new NPDDomainElement(sourceBlock.getNode(), returnElement,
					NPDDomainElement.getSource(),
					sourceBlock.getDelegate().getInstruction(),
					NPDDomainElement));
				result.add(newFactId);
			}
		}
	}

	private void processReturnFieldElement(ReturnFieldElement returnFieldElement, NPDDomainElement NPDDomainElement,
										   MutableSparseIntSet result) {
		SSAInstruction lastInstruction = sourceBlock.getLastInstruction();
		if (!(lastInstruction instanceof SSAInvokeInstruction invokeInstruction)) {
			throw new IllegalStateException("Expected an SSAInvokeInstruction.");
		}

		if (invokeInstruction.getNumberOfReturnValues() > 0 && !handlerBlock.isCatchBlock()) {
			int returnValue = invokeInstruction.getDef();
			NormalFieldElement newFieldElement = new NormalFieldElement(returnValue, returnFieldElement.getFieldRef(),
				sourceBlock.getNode());
			int newFactId = domain.add(new NPDDomainElement(sourceBlock.getNode(), newFieldElement,
				NPDDomainElement.getSource(),
				sourceBlock.getDelegate().getInstruction(),
				NPDDomainElement));
			result.add(newFactId);
		}
	}

	private void processExceptionElement(NPDDomainElement NPDDomainElement, MutableSparseIntSet result) {
		if (handlerBlock.isExitBlock()) {
			ExceptionElement newExceptionElement = new ExceptionElement(handlerBlock.getNode());
			int newFactId = domain.add(new NPDDomainElement(sourceBlock.getNode(), newExceptionElement,
				NPDDomainElement.getSource(),
				sourceBlock.getDelegate().getInstruction(),
				NPDDomainElement));
			result.add(newFactId);
		} else if (handlerBlock.isCatchBlock()) {
			SSAGetCaughtExceptionInstruction caughtExceptionInstruction = handlerBlock.getDelegate().getCatchInstruction();
			if (caughtExceptionInstruction != null) {
				int exceptionValue = caughtExceptionInstruction.getException();
				LocalElement exceptionElement = new LocalElement(exceptionValue, handlerBlock.getNode());
				int newFactId = domain.add(new NPDDomainElement(sourceBlock.getNode(), exceptionElement,
					NPDDomainElement.getSource(),
					sourceBlock.getDelegate().getInstruction(),
					NPDDomainElement));
				result.add(newFactId);
			}
		}
	}
}

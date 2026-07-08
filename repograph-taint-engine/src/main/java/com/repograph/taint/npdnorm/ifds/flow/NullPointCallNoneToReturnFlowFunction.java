package com.repograph.taint.npdnorm.ifds.flow;

import com.repograph.taint.common.StaticFieldAnalysis;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.SourceContext;
import com.repograph.taint.domain.element.ICodeElement;
import com.repograph.taint.domain.element.LocalElement;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.domain.element.NormalFieldElement;
import com.repograph.taint.npdnorm.ifds.NullPointerDeferenceDomain;
import com.repograph.taint.domain.element.StaticFieldElement;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolverManager;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IField;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSACFG;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;


public class NullPointCallNoneToReturnFlowFunction implements IUnaryFlowFunction {

	private static final int DEFAULT_FACT_ID = 0;
	private final Logger logger = LoggerFactory.getLogger(NullPointCallNoneToReturnFlowFunction.class);
	private final PropagationRuleManager ruleManager;
	private final BasicBlockInContext<IExplodedBasicBlock> sourceBlock;
	private final BasicBlockInContext<IExplodedBasicBlock> targetBlock;
	private final NullPointerDeferenceDomain<IDomainElement> domain;
	private final NPDSolverManager npdSolverManager;

	/**
	 * Constructor for NullPointerFlowFunction.
	 *
	 * @param solverManager The solver manager handling the analysis.
	 * @param ruleManager   The propagation rule manager.
	 * @param sourceBlock   The source basic block in the control flow graph.
	 * @param targetBlock   The target basic block in the control flow graph.
	 */
	public NullPointCallNoneToReturnFlowFunction(
		SolverManager solverManager,
		PropagationRuleManager ruleManager,
		BasicBlockInContext<IExplodedBasicBlock> sourceBlock, BasicBlockInContext<IExplodedBasicBlock> targetBlock) {
		this.sourceBlock = sourceBlock;
		this.targetBlock = targetBlock;
		this.ruleManager = ruleManager;
		this.npdSolverManager = (NPDSolverManager) solverManager;
		this.domain = (NullPointerDeferenceDomain<IDomainElement>) solverManager.getDomain();
	}

	@Override
	public IntSet getTargets(int factId) {
		MutableSparseIntSet resultSet = MutableSparseIntSet.makeEmpty();
		npdSolverManager.addBBVisited(targetBlock.getNode(), targetBlock);

		if (factId == DEFAULT_FACT_ID) {
			processDefaultFact(resultSet);
		} else {
			processNonDefaultFact(factId, resultSet);
		}

		return resultSet;
	}

	private void processDefaultFact(MutableSparseIntSet resultSet) {
		resultSet.add(DEFAULT_FACT_ID);
		SSAInvokeInstruction invokeInstruction = (SSAInvokeInstruction) sourceBlock.getDelegate().getInstruction();

//		if (NPDSolverManager.configureSource) {
//			handleConfiguredSource(invokeInstruction, resultSet);
//		} else {
//			handleUnconfiguredSource(invokeInstruction, resultSet);
//		}
	}

	private void handleConfiguredSource(SSAInvokeInstruction invokeInstruction, MutableSparseIntSet resultSet) {
		if (npdSolverManager.getCurrentSourceSinkGroup() != null && npdSolverManager.getSources().contains(sourceBlock)) {
			int defVar = invokeInstruction.getDef();
			if (defVar > 0) {
				LocalElement localElement = new LocalElement(defVar, sourceBlock.getNode());
				int factId = this.domain.add(new NPDDomainElement(sourceBlock.getNode(), localElement,
					new SourceContext(sourceBlock, null), invokeInstruction, null));
				this.domain.addNullConstant(sourceBlock.getNode(), localElement);
				resultSet.add(factId);
			}
		}
	}

	private void handleUnconfiguredSource(SSAInvokeInstruction invokeInstruction, MutableSparseIntSet resultSet) {
		if (npdSolverManager.getSourceCount() < NPDSolverManager.MAX_SOURCES
			&& sourceBlock.getNode().getIR().getMethod().getDeclaringClass().getClassLoader().getReference().equals(ClassLoaderReference.Application)) {

			if (sourceBlock.getNode().getMethod().isInit()
				&& !invokeInstruction.isStatic()
				&& !targetBlock.getDelegate().isExitBlock()
				&& !sourceBlock.getDelegate().isEntryBlock()) {

				handleConstructorSource(invokeInstruction, resultSet);
			}

			if (sourceBlock.getNode().getMethod().isClinit() &&
				!targetBlock.getDelegate().isExitBlock() &&
				!sourceBlock.getDelegate().isEntryBlock()) {

				handleStaticInitializerSource(invokeInstruction, resultSet);
			}
		}
	}

	private void handleConstructorSource(SSAInvokeInstruction invokeInstruction, MutableSparseIntSet resultSet) {
		SSACFG.BasicBlock sourceBasicBlock = sourceBlock.getNode().getIR().getControlFlowGraph()
			.getBasicBlock(sourceBlock.getDelegate().getOriginalNumber());
		SSACFG.BasicBlock targetBasicBlock = targetBlock.getNode().getIR().getControlFlowGraph()
			.getBasicBlock(targetBlock.getDelegate().getOriginalNumber());

		if (!sourceBlock.getNode().getIR().getControlFlowGraph().hasExceptionalEdge(sourceBasicBlock, targetBasicBlock) &&
			invokeInstruction.getCallSite().getDeclaredTarget().getSignature().equals("java.lang.Object.<init>()V") &&
			invokeInstruction.getUse(0) == 1) {

			IClass declaringClass = sourceBlock.getNode().getMethod().getDeclaringClass();
			if (!npdSolverManager.ignoreAnnotation(declaringClass.getAnnotations())) {
				for (IField field : declaringClass.getDeclaredInstanceFields()) {
					if (!npdSolverManager.ignoreAnnotation(field.getAnnotations()) &&
						!field.getFieldTypeReference().getName().toString().equals("Lorg/slf4j/Logger") &&
						!field.getFieldTypeReference().isPrimitiveType()) {

						NormalFieldElement fieldElement = new NormalFieldElement(1, field.getReference(), sourceBlock.getNode());
						int factId = this.domain.add(new NPDDomainElement(sourceBlock.getNode(), fieldElement,
							new SourceContext(sourceBlock, null), invokeInstruction, null));
						this.domain.addNullConstant(sourceBlock.getNode(), fieldElement);
						resultSet.add(factId);
						npdSolverManager.addSourceCount();
					}
				}
			}
		}
	}

	private void handleStaticInitializerSource(SSAInvokeInstruction invokeInstruction,
											   MutableSparseIntSet resultSet) {
		IClass declaringClass = this.sourceBlock.getNode().getMethod().getDeclaringClass();

		for (IField field : declaringClass.getDeclaredStaticFields()) {
			if (!npdSolverManager.ignoreAnnotation(field.getAnnotations()) &&
				!field.getFieldTypeReference().getName().toString().equals("Lorg/slf4j/Logger")) {

				StaticFieldElement fieldElement = new StaticFieldElement(field.getReference());
				NPDDomainElement npdDomainElement = new NPDDomainElement(sourceBlock.getNode(), fieldElement,
					new SourceContext(sourceBlock, null), invokeInstruction, null);

				if (!this.domain.hasMappedIndex(npdDomainElement)) {
					int factId = this.domain.add(npdDomainElement);
					this.domain.addNullConstant(sourceBlock.getNode(), fieldElement);
					resultSet.add(factId);
					npdSolverManager.addSourceCount();
				}
			}
		}
	}

	private void processNonDefaultFact(int factId, MutableSparseIntSet resultSet) {
		ICodeElement codeElement = ((NPDDomainElement) domain.getMappedObject(factId)).getCodeElement();
		if (codeElement instanceof StaticFieldElement) {
			boolean isUsed = StaticFieldAnalysis.getInstance().isStaticFieldUsed(
				npdSolverManager.getCallgraph(), sourceBlock.getNode(), ((StaticFieldElement) codeElement).getFieldRef());
			if (!isUsed) {
				resultSet.add(factId);
			}
		}
	}
}

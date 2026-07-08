package com.repograph.taint.npdnorm.ifds.flow;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.SourceContext;
import com.repograph.taint.domain.element.ICodeElement;
import com.repograph.taint.domain.element.LocalElement;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.domain.element.NormalFieldElement;
import com.repograph.taint.npdnorm.ifds.NullPointerDeferenceDomain;
import com.repograph.taint.domain.element.StaticFieldElement;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolverManager;
import com.repograph.taint.npdnorm.ifds.visitor.NullPointerInstructionVisitor;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.classLoader.IField;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSACFG;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import static com.repograph.taint.Engine.evaluateBeforeCoreInst;

public class NullPointCallToReturnFlowFunction implements IUnaryFlowFunction {

	private static final int DEFAULT_FACT_ID = 0;

	private final Logger logger = LoggerFactory.getLogger(NullPointCallToReturnFlowFunction.class);
	private final PropagationRuleManager ruleManager;
	private final BasicBlockInContext<IExplodedBasicBlock> sourceBlock;
	private final BasicBlockInContext<IExplodedBasicBlock> targetBlock;
	private final NPDSolverManager npdSolverManager;
	private final NullPointerDeferenceDomain<IDomainElement> domain;

	/**
	 * Constructor for CallToReturnFlowFunction.
	 *
	 * @param solverManager The solver manager for analysis components.
	 * @param ruleManager   The rule manager for propagation rules.
	 * @param sourceBlock   The source block in the CFG.
	 * @param targetBlock   The target block in the CFG.
	 */
	public NullPointCallToReturnFlowFunction(SolverManager solverManager, PropagationRuleManager ruleManager,
											 BasicBlockInContext<IExplodedBasicBlock> sourceBlock,
											 BasicBlockInContext<IExplodedBasicBlock> targetBlock) {
		this.npdSolverManager = (NPDSolverManager) solverManager;
		this.domain = (NullPointerDeferenceDomain<IDomainElement>) solverManager.getDomain();
		this.sourceBlock = sourceBlock;
		this.targetBlock = targetBlock;
		this.ruleManager = ruleManager;
	}

	@Override
	public IntSet getTargets(int factId) {
		npdSolverManager.addBBVisited(targetBlock.getNode(), targetBlock);
		MutableSparseIntSet result = MutableSparseIntSet.makeEmpty();

		if (factId == DEFAULT_FACT_ID) {
			processDefaultFact(result);
		} else {
			processFact(factId, result);
		}

		return result;
	}

	private void processDefaultFact(MutableSparseIntSet result) {
		result.add(DEFAULT_FACT_ID);

		SSAInvokeInstruction invokeInstruction = (SSAInvokeInstruction) sourceBlock.getDelegate().getInstruction();

//		if (NPDSolverManager.configureSource) {
//			processConfiguredSource(result, invokeInstruction);
//		} else {
//			processUnconfiguredSource(result, invokeInstruction);
//		}
	}

	private void processConfiguredSource(MutableSparseIntSet result, SSAInvokeInstruction invokeInstruction) {
		if (npdSolverManager.getCurrentSourceSinkGroup() != null && npdSolverManager.getSources().contains(sourceBlock)) {
			int returnValue = invokeInstruction.getDef();
			if (returnValue > 0) {
				LocalElement localElement = new LocalElement(returnValue, sourceBlock.getNode());
				int factId = domain.add(new NPDDomainElement(sourceBlock.getNode(), localElement,
					new SourceContext(sourceBlock, null), invokeInstruction, null));
				domain.addNullConstant(sourceBlock.getNode(), localElement);
				result.add(factId);
			}
		}
	}

	private void processUnconfiguredSource(MutableSparseIntSet result, SSAInvokeInstruction invokeInstruction) {
		if (npdSolverManager.getSourceCount() < NPDSolverManager.MAX_SOURCES &&
			sourceBlock.getNode().getIR().getMethod().getDeclaringClass().getClassLoader().getReference()
				.equals(ClassLoaderReference.Application)) {

			processConstructorSource(result, invokeInstruction);
			processStaticInitializerSource(result, invokeInstruction);
		}
	}

	private void processConstructorSource(MutableSparseIntSet result, SSAInvokeInstruction invokeInstruction) {
		if (sourceBlock.getNode().getMethod().isInit() && !invokeInstruction.isStatic()
			&& !targetBlock.getDelegate().isExitBlock() && !sourceBlock.getDelegate().isEntryBlock()) {

			SSACFG.BasicBlock sourceBasicBlock = sourceBlock.getNode().getIR().getControlFlowGraph()
				.getBasicBlock(sourceBlock.getDelegate().getOriginalNumber());
			SSACFG.BasicBlock targetBasicBlock = targetBlock.getNode().getIR().getControlFlowGraph()
				.getBasicBlock(targetBlock.getDelegate().getOriginalNumber());

			if (!sourceBlock.getNode().getIR().getControlFlowGraph().hasExceptionalEdge(sourceBasicBlock, targetBasicBlock)
				&& invokeInstruction.getCallSite().getDeclaredTarget().getSignature().equals("java.lang.Object.<init>()V")
				&& invokeInstruction.getUse(0) == 1) {

				IClass declaringClass = sourceBlock.getNode().getMethod().getDeclaringClass();
				if (npdSolverManager.ignoreAnnotation(declaringClass.getAnnotations())) {
					return;
				}

				for (IField field : declaringClass.getDeclaredInstanceFields()) {
					if (shouldAddFieldAsSource(field)) {
						addInstanceFieldSource(result, field, invokeInstruction);
					}
				}
			}
		}
	}

	private boolean shouldAddFieldAsSource(IField field) {
		return !npdSolverManager.ignoreAnnotation(field.getAnnotations()) &&
			!field.getFieldTypeReference().getName().toString().equals("Lorg/slf4j/Logger") &&
			!field.getFieldTypeReference().isPrimitiveType();
	}

	private void addInstanceFieldSource(MutableSparseIntSet result, IField field, SSAInvokeInstruction invokeInstruction) {
		NormalFieldElement fieldElement = new NormalFieldElement(1, field.getReference(), sourceBlock.getNode());
		int factId = domain.add(new NPDDomainElement(sourceBlock.getNode(), fieldElement,
			new SourceContext(sourceBlock, null), invokeInstruction, null));
		domain.addNullConstant(sourceBlock.getNode(), fieldElement);
		result.add(factId);
		npdSolverManager.addSourceCount();
	}

	private void processStaticInitializerSource(MutableSparseIntSet result, SSAInvokeInstruction invokeInstruction) {
		if (sourceBlock.getNode().getMethod().isClinit()
			&& !targetBlock.getDelegate().isExitBlock()
			&& !sourceBlock.getDelegate().isEntryBlock()) {

			SSACFG.BasicBlock sourceBasicBlock = sourceBlock.getNode().getIR().getControlFlowGraph()
				.getBasicBlock(sourceBlock.getDelegate().getOriginalNumber());
			SSACFG.BasicBlock targetBasicBlock = targetBlock.getNode().getIR().getControlFlowGraph()
				.getBasicBlock(targetBlock.getDelegate().getOriginalNumber());

			if (!sourceBlock.getNode().getIR().getControlFlowGraph().hasExceptionalEdge(sourceBasicBlock, targetBasicBlock)) {
				IClass declaringClass = sourceBlock.getNode().getMethod().getDeclaringClass();

				for (IField field : declaringClass.getDeclaredStaticFields()) {
					if (shouldAddFieldAsSource(field)) {
						addStaticFieldSource(result, field, invokeInstruction);
					}
				}
			}
		}
	}

	private void addStaticFieldSource(MutableSparseIntSet result, IField field, SSAInvokeInstruction invokeInstruction) {
		StaticFieldElement fieldElement = new StaticFieldElement(field.getReference());
		NPDDomainElement npdDomainElement = new NPDDomainElement(sourceBlock.getNode(), fieldElement,
			new SourceContext(sourceBlock, null), invokeInstruction, null);

		if (!domain.hasMappedIndex(npdDomainElement)) {
			int factId = domain.add(npdDomainElement);
			domain.addNullConstant(sourceBlock.getNode(), fieldElement);
			result.add(factId);
			npdSolverManager.addSourceCount();
		}
	}

	private void processFact(int factId, MutableSparseIntSet result) {
		// Additional processing logic for non-default facts
		if (ruleManager.canProcess(factId, sourceBlock)) {
			processWithPropagationRules(factId, result);
		} else {
			processWithoutPropagationRules(factId, result);
		}
	}

	private void processWithPropagationRules(int factId, MutableSparseIntSet result) {
		MutableSparseIntSet intermediateFacts = evaluateBeforeCoreInst(sourceBlock, factId,
			new NullPointerInstructionVisitor(npdSolverManager, factId, sourceBlock, targetBlock));

		for (IntIterator it = intermediateFacts.intIterator(); it.hasNext(); ) {
			int intermediateFactId = it.next();
			IntSet propagatedFacts = ruleManager.applyCallToReturnFlowFunction(intermediateFactId, sourceBlock);
			if (!propagatedFacts.isEmpty()) {
				result.addAll(propagatedFacts);
			}
		}
	}

	private void processWithoutPropagationRules(int factId, MutableSparseIntSet result) {
		MutableSparseIntSet intermediateFacts = evaluateBeforeCoreInst(sourceBlock, factId,
			new NullPointerInstructionVisitor(npdSolverManager, factId, sourceBlock, targetBlock));
		intermediateFacts.foreach(e -> {
			NPDDomainElement npdDomainElement = (NPDDomainElement) domain.getMappedObject(e);

			ICodeElement codeElement = npdDomainElement.getCodeElement();

			if (codeElement instanceof LocalElement) {
				result.add(e);
			} else if (codeElement instanceof NormalFieldElement fieldElement) {
				int valueNumber = fieldElement.getValueNumber();
				SSAInstruction lastInstruction = this.sourceBlock.getLastInstruction();

				if (!(lastInstruction instanceof SSAInvokeInstruction)) {
					throw new AssertionError("Last instruction is not an SSAInvokeInstruction");
				}

				if (!DFAUtils.containUse(lastInstruction, valueNumber)) {
					result.add(e);
				}
			}
		});
	}
}

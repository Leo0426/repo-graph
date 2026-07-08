package com.repograph.taint.npdnorm.ifds.visitor;

import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.SourceContext;
import com.repograph.taint.domain.element.*;
import com.repograph.taint.domain.element.NPDDomainElement;
import com.repograph.taint.npdnorm.ifds.solver.NPDSolverManager;
import com.repograph.taint.npdnorm.ifds.NullPointerDeferenceDomain;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.AbsNormalFlowVisitor;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.shrike.shrikeBT.IConditionalBranchInstruction;
import com.ibm.wala.ssa.*;
import com.ibm.wala.ssa.analysis.ExplodedControlFlowGraph;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

/**
 * The NullPointerInstructionVisitor class is a visitor for instructions in a control flow graph
 * to detect and handle potential null pointer dereference scenarios. It utilizes a taint analysis
 * domain to track the flow of null values and ensures that potential null dereferences are logged
 * or tracked for further analysis.
 * <p>
 * This class is designed to work in conjunction with the WALA framework's intermediate representation (SSA)
 * and control flow graphs, aiding in static analysis of code.
 * <p>
 * Supported scenarios include:
 * - Handling unary and binary operations to propagate null information.
 * - Identification of conditional branches involving null comparisons.
 * - Tracking of return instructions that may utilize null values.
 * - Recording and mapping facts in a domain that associates potential null dereferences
 * with control flow graph blocks and instructions.
 *
 * @author leolu
 * @since 2025/3/10
 */
public class NullPointerInstructionVisitor extends AbsNormalFlowVisitor {

	private final NullPointerDeferenceDomain<IDomainElement> nullPointerDomain;
	private final int factId;
	private final NPDDomainElement mappedNPDDomainElement;
	private final ICodeElement codeElement;
	private final CGNode cgNode;
	private final BasicBlockInContext<IExplodedBasicBlock> sourceBlock;
	private final BasicBlockInContext<IExplodedBasicBlock> targetBlock;
	private final IR ir;
	private final PointerAnalysis<InstanceKey> pointerAnalysis;
	private final IClassHierarchy classHierarchy;
	private final NPDSolverManager npdSolverManager;

	/**
	 * Constructs a NullPointerInstructionVisitor for analyzing potential null pointer dereference issues
	 * between two basic blocks in the control flow graph.
	 *
	 * @param solverManager The solver manager that provides access to the domain, pointer analysis, and class hierarchy.
	 *                      It is used to retrieve the domain and set up the analysis context.
	 * @param factId        The unique identifier of a fact being analyzed in the null pointer analysis domain.
	 *                      These facts represent the state of variables or elements being tracked.
	 * @param sourceBlock   The basic block in the control flow graph where the taint analysis starts.
	 * @param targetBlock   The basic block in the control flow graph that acts as the destination of the analysis.
	 */
	public NullPointerInstructionVisitor(SolverManager solverManager, int factId,
										 BasicBlockInContext<IExplodedBasicBlock> sourceBlock,
										 BasicBlockInContext<IExplodedBasicBlock> targetBlock) {
		this.nullPointerDomain = (NullPointerDeferenceDomain<IDomainElement>) solverManager.getDomain();
		this.pointerAnalysis = solverManager.getPointerAnalysis();
		this.classHierarchy = solverManager.getClassHierarchy();
		this.factId = factId;
		this.mappedNPDDomainElement = (NPDDomainElement) nullPointerDomain.getMappedObject(this.factId);
		this.codeElement = mappedNPDDomainElement.getCodeElement();
		this.cgNode = sourceBlock.getNode();
		this.sourceBlock = sourceBlock;
		this.targetBlock = targetBlock;
		this.ir = this.cgNode.getIR();
		this.npdSolverManager = (NPDSolverManager) solverManager;
	}

	/**
	 * Processes a GOTO instruction by marking the fact as visited.
	 *
	 * @param instruction The SSA GOTO instruction being visited.
	 */
	@Override
	public void visitGoto(SSAGotoInstruction instruction) {
		this.ret.add(this.factId);
	}

	/**
	 * Processes an array load instruction, keeping the fact unchanged.
	 *
	 * @param instruction An SSA instruction that loads values from an array.
	 */
	@Override
	public void visitArrayLoad(SSAArrayLoadInstruction instruction) {
		this.ret.add(this.factId);
	}

	/**
	 * Processes an array store instruction, tracking any pointers involved.
	 *
	 * @param instruction An SSA instruction that stores values into an array.
	 */
	@Override
	public void visitArrayStore(SSAArrayStoreInstruction instruction) {
		this.ret.add(this.factId);
	}

	/**
	 * Processes a binary operation that may involve null values, delegating the handling
	 * to the shared unary/binary operation handler.
	 *
	 * @param instruction The SSA binary operation instruction being visited.
	 */
	@Override
	public void visitBinaryOp(SSABinaryOpInstruction instruction) {
		handleUnaryOrBinaryOperation(instruction);
	}

	@Override
	public void visitUnaryOp(SSAUnaryOpInstruction instruction) {
		handleUnaryOrBinaryOperation(instruction);
	}

	@Override
	public void visitConversion(SSAConversionInstruction instruction) {
		handleUnaryOrBinaryOperation(instruction);
	}

	@Override
	public void visitComparison(SSAComparisonInstruction instruction) {
		this.ret.add(this.factId);
	}

	/**
	 * Processes conditional branch instructions, checking if the branch condition involves null.
	 * If the fact ID generates a null pointer flow, it handles the null-dependent conditional branch.
	 *
	 * @param instruction The SSA conditional branch instruction to analyze.
	 */
	@Override
	public void visitConditionalBranch(SSAConditionalBranchInstruction instruction) {
		if (this.factId == 0) {
			handleConditionalBranchOnNull(instruction);
		} else {
			this.ret.add(this.factId);
		}
	}

	/**
	 * 根据条件分支目标的基本块判断是否为符合预期的流向
	 * 如果符合条件，记录潜在的空指针分析结果到 nullPointerDomain 并返回一个新Fact
	 */
	private void handleConditionalBranchOnNull(SSAConditionalBranchInstruction instruction) {
		SymbolTable symbolTable = this.ir.getSymbolTable();
		int use1 = instruction.getUse(0);
		int use2 = instruction.getUse(1);
		IConditionalBranchInstruction.IOperator operator = instruction.getOperator();

		if (!(operator instanceof IConditionalBranchInstruction.Operator conditionalOperator)) {
			throw new IllegalStateException("Unknown conditional operator type: " + operator.getClass());
		}

		// find target index.
		ExplodedControlFlowGraph cfg = ExplodedControlFlowGraph.make(this.cgNode.getIR());
		int targetInstructionIndex = instruction.getTarget();

		// target bb in context
		BasicBlockInContext<IExplodedBasicBlock> targetBlock
			= new BasicBlockInContext<>(this.cgNode, cfg.getBlockForInstruction(targetInstructionIndex));

		// If one operand is null, the other operand is considered potentially null-dependent,
		// and LocalElement is used to describe the variable associated with the current null value.
		LocalElement localElement = null;
		if (symbolTable.isNullConstant(use1)) {
			localElement = new LocalElement(use2, this.cgNode);
		} else if (symbolTable.isNullConstant(use2)) {
			localElement = new LocalElement(use1, this.cgNode);
		}

		// if x == null {} else {}
		// add next block to domain.
		if (localElement != null && ((conditionalOperator.equals(IConditionalBranchInstruction.Operator.EQ)
			&& this.targetBlock.equals(targetBlock))
			|| (conditionalOperator.equals(IConditionalBranchInstruction.Operator.NE)
			&& !this.targetBlock.equals(targetBlock)))) {
			int newFactId = this.nullPointerDomain.add(
				new NPDDomainElement(this.cgNode, localElement,
					new SourceContext(this.sourceBlock, null), instruction, null)
			);
			this.ret.add(newFactId);
		}
	}

	@Override
	public void visitReturn(SSAReturnInstruction instruction) {
		handleReturn(instruction);
	}


	// v1 = <some computation>;
	// return v1;
	private void handleReturn(SSAReturnInstruction instruction) {
		this.ret.add(this.factId);
		if (!instruction.returnsVoid()) {
			int result = instruction.getResult();
			if (codeElement instanceof LocalElement localElement && localElement.getValueNumber() == result) {
				ReturnElement returnElement = new ReturnElement(result, this.cgNode);
				int newFactId = this.nullPointerDomain.add(
					new NPDDomainElement(this.cgNode, returnElement, mappedNPDDomainElement.getSource(),
						instruction, mappedNPDDomainElement)
				);
				this.ret.add(newFactId);
			} else if (codeElement instanceof NormalFieldElement normalFieldElement
				&& normalFieldElement.getValueNumber() == result) {
				ReturnFieldElement returnFieldElement = new ReturnFieldElement(this.cgNode, normalFieldElement.getFieldRef());
				int newFactId = this.nullPointerDomain.add(
					new NPDDomainElement(this.cgNode, returnFieldElement, mappedNPDDomainElement.getSource(),
						instruction, mappedNPDDomainElement)
				);
				this.ret.add(newFactId);
			}
		}
	}

	private void handleUnaryOrBinaryOperation(SSAInstruction instruction) {
		int numUses = instruction.getNumberOfUses();
		if (codeElement instanceof LocalElement localElement) {
			int valueNumber = localElement.getValueNumber();
			this.ret.add(this.factId);

			for (int i = 0; i < numUses; i++) {
				int use = instruction.getUse(i);
				if (use == valueNumber) {
					int definition = instruction.getDef();
					LocalElement newLocalElement = new LocalElement(definition, this.cgNode);
					int newFactId = this.nullPointerDomain.add(
						new NPDDomainElement(this.cgNode, newLocalElement, mappedNPDDomainElement.getSource(),
							instruction, mappedNPDDomainElement)
					);
					this.ret.add(newFactId);
					break;
				}
			}
		}
	}

}

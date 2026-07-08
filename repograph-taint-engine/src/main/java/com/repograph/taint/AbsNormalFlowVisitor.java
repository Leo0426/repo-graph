package com.repograph.taint;

import com.ibm.wala.ssa.*;
import com.ibm.wala.util.intset.MutableSparseIntSet;

/**
 * Abstract visitor class implementing the `SSAInstruction.IVisitor` interface.
 * This class serves as a base for handling control-flow analysis through different SSA instruction types.
 * Subclasses should override the desired `visit*` methods to provide custom processing logic.
 *
 * @author leo
 * @since 2025/1/2
 */
public abstract class AbsNormalFlowVisitor implements SSAInstruction.IVisitor {

	protected final MutableSparseIntSet ret = MutableSparseIntSet.makeEmpty();

	/**
	 * Provides access to the mutable integer set (`ret`) used in this visitor to
	 * store results or data specific to the analysis process.
	 *
	 * @return the mutable integer set used by this visitor.
	 */
	public MutableSparseIntSet getIntSet() {
		return ret;
	}

	/**
	 * Handles `SSAGotoInstruction`, representing an unconditional branch or jump instruction.
	 * Subclasses can override this method to provide logic for handling such instructions.
	 *
	 * @param instruction the `SSAGotoInstruction` to process.
	 */
	@Override
	public void visitGoto(SSAGotoInstruction instruction) {
	}

	/**
	 * Handles `SSAArrayLoadInstruction`, representing an array element load operation.
	 * Subclasses can override to add custom handling for array access instructions.
	 *
	 * @param instruction the `SSAArrayLoadInstruction` to process.
	 */
	@Override
	public void visitArrayLoad(SSAArrayLoadInstruction instruction) {
	}

	@Override
	public void visitArrayStore(SSAArrayStoreInstruction instruction) {
	}

	/**
	 * Handles `SSABinaryOpInstruction`, representing a binary operation (e.g., addition, subtraction).
	 * Subclasses can override to provide logic for arithmetic or logical operations.
	 *
	 * @param instruction the `SSABinaryOpInstruction` to process.
	 */
	@Override
	public void visitBinaryOp(SSABinaryOpInstruction instruction) {
	}

	/**
	 * Handles `SSAUnaryOpInstruction`, representing a unary operation (e.g., negation).
	 * Subclasses can provide specific logic for such instructions by overriding this method.
	 *
	 * @param instruction the `SSAUnaryOpInstruction` to process.
	 */
	@Override
	public void visitUnaryOp(SSAUnaryOpInstruction instruction) {
	}

	@Override
	public void visitConversion(SSAConversionInstruction instruction) {
	}

	@Override
	public void visitComparison(SSAComparisonInstruction instruction) {
	}

	/**
	 * Handles `SSAConditionalBranchInstruction`, representing a conditional branch based
	 * on some boolean expression. Subclasses can override for custom branching logic.
	 *
	 * @param instruction the `SSAConditionalBranchInstruction` to process.
	 */
	@Override
	public void visitConditionalBranch(SSAConditionalBranchInstruction instruction) {
	}

	@Override
	public void visitSwitch(SSASwitchInstruction instruction) {

	}

	/**
	 * Handles `SSAReturnInstruction`, representing a method return statement.
	 * Subclasses can override to implement custom handling of return operations.
	 *
	 * @param instruction the `SSAReturnInstruction` to process.
	 */
	@Override
	public void visitReturn(SSAReturnInstruction instruction) {
	}

	@Override
	public void visitGet(SSAGetInstruction instruction) {

	}

	@Override
	public void visitPut(SSAPutInstruction instruction) {

	}

	@Override
	public void visitInvoke(SSAInvokeInstruction instruction) {

	}

	@Override
	public void visitNew(SSANewInstruction instruction) {

	}

	@Override
	public void visitArrayLength(SSAArrayLengthInstruction instruction) {

	}

	@Override
	public void visitThrow(SSAThrowInstruction instruction) {

	}

	@Override
	public void visitMonitor(SSAMonitorInstruction instruction) {

	}

	@Override
	public void visitCheckCast(SSACheckCastInstruction instruction) {

	}

	@Override
	public void visitInstanceof(SSAInstanceofInstruction instruction) {

	}

	@Override
	public void visitPhi(SSAPhiInstruction instruction) {

	}

	@Override
	public void visitPi(SSAPiInstruction instruction) {

	}

	@Override
	public void visitGetCaughtException(SSAGetCaughtExceptionInstruction instruction) {

	}

	@Override
	public void visitLoadMetadata(SSALoadMetadataInstruction instruction) {

	}

}

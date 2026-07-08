/*
 *
 * MIT License
 *
 * Copyright (c) 2023 Leo Lu.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

package com.repograph.taint.solver;

import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.ssa.SSAGetInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSAPutInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;

import java.util.Map;
import java.util.Set;

/**
 * filed inst visitor.
 *
 * @author leolu
 * @since 2024/8/20
 */
public class FieldInstVisitor extends SSAInstruction.Visitor {
	private final Map<IExplodedBasicBlock, Set<FieldReference>> bb2fieldRefMap;
	private final Map<FieldReference, Set<IExplodedBasicBlock>> fieldRef2BBMap;
	private final Set<IExplodedBasicBlock> callContainingBBs;
	private final Set<IExplodedBasicBlock> putFieldContainingBBs;
	private final Set<FieldReference> allFieldRefs;
	private IExplodedBasicBlock currentBB;

	/**
	 * Constructor for the `h` class.
	 *
	 * @param fieldCFG              The FieldCFG instance, not used directly but provides context.
	 * @param bb2fieldRefMap        A map from basic blocks to the field references they interact with.
	 * @param callContainingBBs     A set of basic blocks that contain method calls.
	 * @param putFieldContainingBBs A set of basic blocks that contain field assignments (PUT operations).
	 * @param allFieldRefs          A set of all field references encountered during the analysis.
	 * @param fieldRef2BBMap        A map from field references to the basic blocks that interact with them.
	 */
	public FieldInstVisitor(
		FieldCFG fieldCFG, Map<IExplodedBasicBlock, Set<FieldReference>> bb2fieldRefMap,
		Set<IExplodedBasicBlock> callContainingBBs, Set<IExplodedBasicBlock> putFieldContainingBBs,
		Set<FieldReference> allFieldRefs, Map<FieldReference, Set<IExplodedBasicBlock>> fieldRef2BBMap) {
		this.bb2fieldRefMap = bb2fieldRefMap;
		this.callContainingBBs = callContainingBBs;
		this.putFieldContainingBBs = putFieldContainingBBs;
		this.allFieldRefs = allFieldRefs;
		this.fieldRef2BBMap = fieldRef2BBMap;
		this.currentBB = null;
	}

	/**
	 * Sets the current basic block that is being analyzed.
	 *
	 * @param currentBB The basic block currently being analyzed.
	 */
	public void getCurrentBB(IExplodedBasicBlock currentBB) {
		this.currentBB = currentBB;
	}

	/**
	 * Handles the analysis of a GET field instruction.
	 * It records the field access in the bb2fieldRefMap and fieldRef2BBMap, and adds the field to allFieldRefs.
	 *
	 * @param paramSSAGetInstruction The GET field instruction being visited.
	 */
	@Override
	public void visitGet(SSAGetInstruction paramSSAGetInstruction) {
		super.visitGet(paramSSAGetInstruction);
		FieldReference fieldReference = paramSSAGetInstruction.getDeclaredField();
		DFAUtils.putElementToMap(this.bb2fieldRefMap, this.currentBB, fieldReference);
		DFAUtils.putElementToMap(this.fieldRef2BBMap, fieldReference, this.currentBB);
		this.allFieldRefs.add(fieldReference);
	}

	/**
	 * Handles the analysis of a PUT field instruction.
	 * It records the field assignment in the bb2fieldRefMap and fieldRef2BBMap, and adds the field to allFieldRefs.
	 * It also marks the current basic block as containing a field assignment.
	 *
	 * @param paramSSAPutInstruction The PUT field instruction being visited.
	 */
	@Override
	public void visitPut(SSAPutInstruction paramSSAPutInstruction) {
		super.visitPut(paramSSAPutInstruction);
		this.putFieldContainingBBs.add(this.currentBB);
		FieldReference fieldReference = paramSSAPutInstruction.getDeclaredField();
		DFAUtils.putElementToMap(this.bb2fieldRefMap, this.currentBB, fieldReference);
		DFAUtils.putElementToMap(this.fieldRef2BBMap, fieldReference, this.currentBB);
		this.allFieldRefs.add(fieldReference);
	}

	/**
	 * Handles the analysis of a method invocation instruction.
	 * It marks the current basic block as containing a method call.
	 *
	 * @param paramSSAInvokeInstruction The method invocation instruction being visited.
	 */
	@Override
	public void visitInvoke(SSAInvokeInstruction paramSSAInvokeInstruction) {
		super.visitInvoke(paramSSAInvokeInstruction);
		this.callContainingBBs.add(this.currentBB);
	}
}

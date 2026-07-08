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

package com.repograph.taint.prelim;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.Summarys;
import com.repograph.taint.domain.AccessPath;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.SSACFG;
import com.ibm.wala.ssa.SSACheckCastInstruction;
import com.ibm.wala.ssa.SSAGetCaughtExceptionInstruction;
import com.ibm.wala.ssa.SSAGetInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInstruction.IVisitor;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSANewInstruction;
import com.ibm.wala.ssa.SSAPhiInstruction;
import com.ibm.wala.ssa.SSAReturnInstruction;
import com.ibm.wala.ssa.SSAThrowInstruction;
import com.ibm.wala.util.collections.Pair;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static com.repograph.taint.api.DomainElementType.EXCEPTION;

public class TransferFunctionSSAVisitor implements IVisitor {

	private final CallGraph callGraph;

	private final CGNode cgNode;

	private final AccessPath accessPath;

	private final IR ir;

	private final SSACFG ssaCfg;

	public Pair<Integer, AccessPath> pair;

	public Set<CGNode> possibleTargets = new HashSet<>();

	public TransferFunctionSSAVisitor(CallGraph callGraph, CGNode cgNode, AccessPath accessPath) {
		this.callGraph = callGraph;
		this.cgNode = cgNode;
		this.accessPath = accessPath;
		this.ir = cgNode.getIR();
		this.ssaCfg = this.ir.getControlFlowGraph();
	}

	public void visitReturn(SSAReturnInstruction instruction) {
		if (!instruction.returnsVoid()) {
			this.addSummary(this.accessPath.clone(), DomainElementType.RETURN);
		}
	}

	public void visitGet(SSAGetInstruction instruction) {
		if (!instruction.isStatic()) {
			AccessPath accessPath = new AccessPath(this.accessPath.getBase(),
				this.accessPath.appendLastField(instruction.getDeclaredField()), this.accessPath.getCGNode());
			this.pair = Pair.make(instruction.getDef(), accessPath);
		}
	}

	public void visitInvoke(SSAInvokeInstruction instruction) {
		this.possibleTargets.addAll(this.callGraph.getPossibleTargets(this.cgNode, instruction.getCallSite()));
		if (instruction.getNumberOfReturnValues() == 1) {
			int def = instruction.getDef();
			AccessPath accessPath = new AccessPath(def, null, this.cgNode);
			this.pair = Pair.make(def, accessPath);
		}
	}

	public void visitThrow(SSAThrowInstruction instruction) {
		SSACFG.BasicBlock block = ssaCfg.getBlockForInstruction(instruction.iIndex());
		ssaCfg.getSuccNodes(block).forEachRemaining(succ -> {
			if (succ instanceof SSACFG.ExceptionHandlerBasicBlock handler) {
				SSAGetCaughtExceptionInstruction caught = handler.getCatchInstruction();
				if (caught != null) {
					pair = Pair.make(caught.getException(), accessPath.clone());
				}
			} else if (succ.isExitBlock()) {
				addSummary(accessPath.clone(), EXCEPTION);
			}
		});
	}

	public void visitCheckCast(SSACheckCastInstruction instruction) {
		if (instruction.getNumberOfUses() == 1) {
			this.pair = Pair.make(instruction.getDef(), this.accessPath.clone());
		}
	}

	public void visitPhi(SSAPhiInstruction var1) {
		AccessPath var2 = new AccessPath(var1.getDef(), null, this.cgNode);
		this.pair = Pair.make(var1.getDef(), var2);
	}

	public void visitNew(SSANewInstruction var1) {
		AccessPath var2 = new AccessPath(var1.getDef(), null, this.cgNode);
		this.pair = Pair.make(var1.getDef(), var2);
	}

	private boolean isIncludeInstruction(AccessPath accessPath) {
		DefUse defUse = accessPath.getCGNode().getDU();
		int base = accessPath.getBase();
		SSAInstruction def = defUse.getDef(base);
		return base <= accessPath.getCGNode().getMethod().getNumberOfParameters()
			|| def instanceof SSANewInstruction
			|| def instanceof SSAPhiInstruction
			|| def instanceof SSAInvokeInstruction;
	}

	public void addSummary(AccessPath accessPath, DomainElementType type) {
		List<AccessPath> fullPaths = APCollector.getInstance().getFullAccessPaths(accessPath)
			.stream()
			.filter(this::isIncludeInstruction)
			.toList();
		if (type == DomainElementType.RETURN) {
			fullPaths.forEach(e -> Summarys.getInstance().addSummary(this.cgNode, -1, e));
		} else if (type == DomainElementType.EXCEPTION) {
			fullPaths.forEach(e -> Summarys.getInstance().addSummary(this.cgNode, -2, e));
		}
	}

	public Pair<Integer, AccessPath> getPair() {
		return this.pair;
	}

	public Set<CGNode> getPossibleTargets() {
		return this.possibleTargets;
	}
}

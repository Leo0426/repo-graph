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

package com.repograph.taint.flow;

import com.repograph.taint.common.CallSiteFinder;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.flow.sparse.SparseFlowFunctionMap;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
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

import java.util.concurrent.ExecutionException;

public class UnbalancedReturnFlowFunction implements IUnaryFlowFunction {

	private final SolverManager solverManager;

	private final PropagationRuleManager propagationRuleManager;

	private final BasicBlockInContext<IExplodedBasicBlock> src;

	private final BasicBlockInContext<IExplodedBasicBlock> dest;

	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;

	private final ICFGSupergraph superGraph;

	/**
	 * Constructor for CallSiteFlowFunction.
	 *
	 * @param solverManager          The solver manager that manages the taint analysis process.
	 * @param propagationRuleManager The manager responsible for handling propagation rules.
	 */
	public UnbalancedReturnFlowFunction(SolverManager solverManager,
										PropagationRuleManager propagationRuleManager,
										BasicBlockInContext<IExplodedBasicBlock> src,
										BasicBlockInContext<IExplodedBasicBlock> dest) {
		this.solverManager = solverManager;
		this.propagationRuleManager = propagationRuleManager;
		this.superGraph = (ICFGSupergraph) solverManager.getICFGSuperGraph();
		this.domain = solverManager.getDomain();
		this.src = src;
		this.dest = dest;

		// Ensure that the source block is an exit block, otherwise throw an error.
		if (!src.isExitBlock()) {
			throw new AssertionError("Source block is not an exit block");
		}
	}

	@Override
	public IntSet getTargets(int d1) {
		if (d1 == 0) {
			return SparseFlowFunctionMap.ZERO_SET;
		} else {
			MutableSparseIntSet targetSet = MutableSparseIntSet.makeEmpty();
			DomainElement domainElement = (DomainElement) this.domain.getMappedObject(d1);

			// Finding all call sites that match the source and target blocks.
			try {
				CallSiteFinder.getInstance(this.superGraph)
					.getAllCallSite(this.src, this.dest, domainElement)
					.stream()
					.filter(block -> block.getNode().equals(this.dest.getNode()))
					.forEach(callSite -> {
						// If the condition holds true for the instruction at the call site, add the targets.
						if (isMatchingCallSite((callSite.getDelegate()).getInstruction(), domainElement)) {
							targetSet.addAll(
								new AssistFlowFunction(solverManager, propagationRuleManager, callSite, this.src, this.dest)
									.getTargets(d1)
							);
						}
					});
			} catch (ExecutionException ignored) {
			}
			return targetSet;
		}
	}

	/**
	 * Checks if the given SSAInstruction matches the criteria for propagation.
	 *
	 * @param instruction   The SSA instruction being analyzed.
	 * @param domainElement The domain element representing the current state in the analysis.
	 * @return True if the instruction matches the criteria, otherwise false.
	 */
	private boolean isMatchingCallSite(SSAInstruction instruction, DomainElement domainElement) {
		// Ensure the instruction is an SSAInvokeInstruction.
		if (!(instruction instanceof SSAInvokeInstruction invokeInstruction)) {
			throw new AssertionError("Instruction is not an SSAInvokeInstruction");
		}

		AccessPath accessPath = domainElement.getAccessPath();

		// If the domain element is an exception or the access path is static, return true.
		if (domainElement.isExceptionType() || accessPath.isStatic()) {
			return true;
		}

		// Check class hierarchy to determine if the class in the access path can be assigned to the target class.
		IClassHierarchy classHierarchy = this.solverManager.getClassHierarchy();
		IClass clazz = classHierarchy.lookupClass(invokeInstruction.getDeclaredTarget().getDeclaringClass());
		IClass accessClazz = accessPath.getCGNode().getMethod().getDeclaringClass();

		return clazz != null && accessClazz != null && classHierarchy.isAssignableFrom(clazz, accessClazz);
	}
}

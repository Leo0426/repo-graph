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

package com.repograph.taint;

import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.solver.FieldCFG;
import com.repograph.taint.solver.FieldCFGManager;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.classLoader.IClass;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.propagation.ContainerUtil;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.ExplodedControlFlowGraph;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.util.MonitorUtil;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

public class SparseUBSolver extends AbstractSparseUBSolver {

	private final SolverManager solverManager;
	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> tabulationDomain;
	private final FieldCFGManager fieldCFGManager;

	/**
	 * @param solverManager the SolverManager used for managing the solving process
	 * @param problem       the specific problem instance
	 * @return a new instance of `b`
	 */
	public static SparseUBSolver create(SolverManager solverManager, ReachingDefsProblem problem) {
		return new SparseUBSolver(solverManager, problem, null);
	}

	/**
	 * @param solverManager the SolverManager used for managing the solving process
	 * @param problem       the specific problem instance
	 * @param monitor       the progress monitor
	 */
	protected SparseUBSolver(SolverManager solverManager,
							 ReachingDefsProblem problem, MonitorUtil.IProgressMonitor monitor) {
		super(problem, monitor);
		this.solverManager = solverManager;
		this.tabulationDomain = problem.getDomain();
		this.fieldCFGManager = new FieldCFGManager(solverManager);
	}

	/**
	 * Determines the fall-through blocks for the given BasicBlockInContext and integer context.
	 *
	 * @param block   the current block
	 * @return an iterator over the possible fall-through blocks
	 */

		@Override
	public Iterator getFallThroughTo(Object block, int d) {
		return this.getFallThroughTo2((BasicBlockInContext<IExplodedBasicBlock>) block, d);
	}

	protected Iterator<BasicBlockInContext<IExplodedBasicBlock>> getFallThroughTo2(BasicBlockInContext<IExplodedBasicBlock> block, int context) {
		if (block.isExitBlock()) {
			HashSet<BasicBlockInContext<IExplodedBasicBlock>> blocks = new HashSet<>();
			blocks.add(block);
			return blocks.iterator();
		}

		ICFGSupergraph supergraph = (ICFGSupergraph) this.supergraph;
		ExplodedControlFlowGraph explodedCFG = (ExplodedControlFlowGraph) supergraph.getCFG(block);
		CGNode node = block.getNode();
		FieldCFG fieldCFG = this.fieldCFGManager.getFieldCFG(explodedCFG);

		if (context == 0) {
			Set<BasicBlockInContext<IExplodedBasicBlock>> blocks = new HashSet<>();
			for (IExplodedBasicBlock bb : fieldCFG.getZeroFallThroughTo(block)) {
				blocks.add(new BasicBlockInContext<>(node, bb));
			}
			return blocks.iterator();
		}

		DomainElement domainElement = (DomainElement) this.tabulationDomain.getMappedObject(context);

		AccessPath accessPath = domainElement.getAccessPath();

		if (domainElement.isExceptionType() || domainElement.isReturnType()) {
			return this.supergraph.getSuccNodes(block);
		}

		if (accessPath.isLocal()) {
			assert !accessPath.getCGNode().equals(node);
			int base = accessPath.getBase();
			Set<BasicBlockInContext<IExplodedBasicBlock>> blocks = new HashSet<>();
			DefUse defUse = node.getDU();
			IR ir = node.getIR();
			boolean foundInvoke = false;
			Iterator<SSAInstruction> uses = defUse.getUses(base);

			while (uses.hasNext()) {
				SSAInstruction instruction = uses.next();
				if (instruction instanceof SSAInvokeInstruction invoke) {
					if (this.solverManager.getKillManager().getInvokeKills().contains(invoke.getDeclaredTarget())) {
						foundInvoke = true;
						break;
					}
					if (!invoke.isStatic() && invoke.getUse(0) == base) {
						foundInvoke = true;
						break;
					}
				}
				int index = instruction.iIndex();
				IExplodedBasicBlock bb = (index == -1) ? explodedCFG
					.getBlockForInstruction(ir.getBasicBlockForInstruction(instruction).getFirstInstructionIndex())
					: explodedCFG.getBlockForInstruction(index);
				blocks.add(new BasicBlockInContext<>(node, bb));
			}

			if (foundInvoke) {
				blocks = new HashSet<>();
				List<IExplodedBasicBlock> fallThroughBlocks = fieldCFG
					.getLocalFallThroughTo(node, base, block.getDelegate());
				for (IExplodedBasicBlock bb : fallThroughBlocks) {
					blocks.add(new BasicBlockInContext<>(node, bb));
				}
			}

			if (base <= node.getMethod().getNumberOfParameters()
				&& isContainerType(node.getClassHierarchy().lookupClass(accessPath.getBaseType()))) {
				blocks.add(new BasicBlockInContext<>(node, explodedCFG.exit()));
			}
			return blocks.iterator();
		}

		int base = accessPath.getBase();
		FieldReference fieldReference = accessPath.getFirstField();

		if (fieldReference == null) {
			throw new AssertionError();
		}

		ArrayList<BasicBlockInContext<IExplodedBasicBlock>> blocks = new ArrayList<>();
		List<IExplodedBasicBlock> fallThroughBlocks = (base == -1)
			? fieldCFG.getFallThroughTo(null, base, fieldReference, block.getDelegate())
			: fieldCFG.getFallThroughTo(node, base, fieldReference, block.getDelegate());
		for (IExplodedBasicBlock bb : fallThroughBlocks) {
			blocks.add(new BasicBlockInContext<>(node, bb));
		}
		return blocks.iterator();
	}

	/**
	 * Checks if the given class represents a container type.
	 *
	 * @param klass the class to check
	 * @return true if the class is a container type, false otherwise
	 */
	private boolean isContainerType(IClass klass) {
		return klass != null && ContainerUtil.isContainer(klass);
	}

	/**
	 * Clears all cached data in this solver, including path edges, summaries, and call flow edges.
	 */
	public void clear() {
		this.clearPathEdges();
		this.clearSummary();
		this.clearCallFlowEdges();
	}
}

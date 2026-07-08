/*
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
 */

package com.repograph.taint.prelim;

import com.repograph.taint.domain.AccessPath;
import com.ibm.wala.classLoader.CallSiteReference;
import com.ibm.wala.classLoader.NewSiteReference;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.SSAAbstractInvokeInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSANewInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.collections.Pair;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedList;
import java.util.Optional;
import java.util.Queue;
import java.util.Set;

public class AssemblerAP {
	private static final Logger LOGGER = LoggerFactory.getLogger(AssemblerAP.class);

	private final CallGraph callGraph;
	private final Set<BasicBlockInContext<IExplodedBasicBlock>> allSource;
	private final Queue<CGNode> pendingCgNodes = new LinkedList<>();
	private final Set<CGNode> visitedCgNodes = new HashSet<>();

	public AssemblerAP(ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> iSupergraph,
					   Set<BasicBlockInContext<IExplodedBasicBlock>> paramSet) {
		this.callGraph = ((ICFGSupergraph) iSupergraph).getICFG().getCallGraph();
		this.allSource = paramSet;
		new APCollector((ICFGSupergraph) iSupergraph);
	}

	public void runAnalysis() {
		LOGGER.info("Begin collecting AccessPath");
		this.allSource.stream()
			.map(BasicBlockInContext::getNode)
			.forEach(pendingCgNodes::add);

		while (!pendingCgNodes.isEmpty()) {
			CGNode current = pendingCgNodes.poll();
			if (visitedCgNodes.add(current)) {
				updateAccessPathsAndInstructionsForNode(current);
			}
		}
		LOGGER.info("Total number of AccessPaths: {}", APCollector.getInstance().getAPNumber());
	}

	private void updateAccessPathsAndInstructionsForNode(CGNode cgNode) {
		callGraph.getPredNodes(cgNode).forEachRemaining(this::addPredNodes);

		Queue<Pair<Integer, AccessPath>> worklist = new LinkedList<>();
		Set<Pair<Integer, AccessPath>> visited = new HashSet<>();

		for (int i = 0; i < cgNode.getMethod().getNumberOfParameters(); i++) {
			int varIndex = i + 1;
			AccessPath ap = new AccessPath(varIndex, null, cgNode);
			Pair<Integer, AccessPath> pair = Pair.make(varIndex, ap);
			worklist.add(pair);
			add(cgNode, varIndex, ap);
		}

		IR ir = cgNode.getIR();
		if (ir == null) return;

		for (Iterator<NewSiteReference> it = ir.iterateNewSites(); it.hasNext(); ) {
			NewSiteReference ns = it.next();
			SSANewInstruction instr = ir.getNew(ns);
			TransferFunctionSSAVisitor visitor = new TransferFunctionSSAVisitor(callGraph, cgNode, null);
			instr.visit(visitor);
			Optional.ofNullable(visitor.getPair()).ifPresent(worklist::add);
		}

		for (Iterator<CallSiteReference> it = ir.iterateCallSites(); it.hasNext(); ) {
			CallSiteReference site = it.next();
			SSAAbstractInvokeInstruction[] calls = ir.getCalls(site);
			if (calls != null) {
				for (SSAAbstractInvokeInstruction call : calls) {
					TransferFunctionSSAVisitor visitor = new TransferFunctionSSAVisitor(callGraph, cgNode, null);
					call.visit(visitor);
					Optional.ofNullable(visitor.getPair()).ifPresent(worklist::add);
					visitor.getPossibleTargets().forEach(this::addPredNodes);
				}
			}
		}

		DefUse defUse = cgNode.getDU();
		while (!worklist.isEmpty()) {
			Pair<Integer, AccessPath> pair = worklist.poll();
			if (visited.add(pair)) {
				try {
					Iterator<SSAInstruction> uses = defUse.getUses(pair.fst);
					while (uses.hasNext()) {
						SSAInstruction use = uses.next();
						TransferFunctionSSAVisitor visitor = new TransferFunctionSSAVisitor(callGraph, cgNode, pair.snd);
						use.visit(visitor);
						Pair<Integer, AccessPath> newPair = visitor.getPair();
						if (newPair != null && visited.add(newPair)) {
							add(cgNode, newPair.fst, newPair.snd);
							worklist.add(newPair);
						}
					}
				} catch (Exception ex) {
					LOGGER.warn("Error processing uses for pair: {}", pair, ex);
				}
			}
		}
	}

	private void addPredNodes(CGNode node) {
		if (!visitedCgNodes.contains(node)) {
			pendingCgNodes.add(node);
		}
	}

	private void add(CGNode cgNode, int index, AccessPath accessPath) {
		APCollector.getInstance().add(cgNode, index, accessPath);
	}
}

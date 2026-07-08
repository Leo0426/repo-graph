package com.repograph.taint.prelim;

import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.Summarys;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cfg.ExplodedInterproceduralCFG;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.IR;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.ExplodedControlFlowGraph;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.util.collections.Pair;

import java.util.*;

public class APCollector {
	private static APCollector instance;

	private final Map<Pair<CGNode, Integer>, AccessPath> value2AP = new HashMap<>();

	private final ICFGSupergraph isg;

	private final CallGraph cg;

	public static APCollector getInstance() {
		assert instance != null;
		return instance;
	}

	public static void clear() {
		if (instance != null) {
			instance.value2AP.clear();
			instance = null;
		}
	}

	public APCollector(ICFGSupergraph paramICFGSupergraph) {
		this.isg = paramICFGSupergraph;
		this.cg = paramICFGSupergraph.getICFG().getCallGraph();
		instance = this;
	}

	public void add(CGNode paramCGNode, int paramInt, AccessPath paramAccessPath) {
		assert paramAccessPath != null;
		Pair<CGNode, Integer> pair = Pair.make(paramCGNode, paramInt);
		if (!this.value2AP.containsKey(pair)) {
			this.value2AP.put(pair, paramAccessPath);
		}
	}

	public Set<AccessPath> getFullAccessPaths(CGNode paramCGNode, int paramInt) {
		if (isConstant(paramCGNode, paramInt)) {
			Set<AccessPath> hashSet = new HashSet<>();
			hashSet.add(new AccessPath(paramInt, null, paramCGNode));
			return hashSet;
		}
		AccessPath accessPath = getAccessPath(paramCGNode, paramInt);
		if (accessPath == null) {
			Set<AccessPath> hashSet = new HashSet<>();
			hashSet.add(new AccessPath(paramInt, null, paramCGNode));
			return hashSet;
		}
		return getFullAccessPaths(accessPath, new ArrayList<>());
	}

	public Set<AccessPath> getFullAccessPaths(AccessPath paramAccessPath) {
		AccessPath accessPath = getAccessPath(paramAccessPath.getCGNode(), paramAccessPath.getBase());
		return (accessPath == null) ? getFullAccessPaths(paramAccessPath, new ArrayList<>())
			: getFullAccessPaths(constructFullAccessPath(accessPath, paramAccessPath), new ArrayList<>());
	}

	private boolean isConstant(CGNode paramCGNode, int paramInt) {
		return paramCGNode.getIR().getSymbolTable().isConstant(paramInt);
	}

	private AccessPath constructFullAccessPath(AccessPath paramAccessPath1, AccessPath paramAccessPath2) {
		List<FieldReference> list = new ArrayList<>();
		if (paramAccessPath1.getFieldRefs() != null) {
			list.addAll(paramAccessPath1.cloneFieldRefs());
		}
		if (paramAccessPath2.getFieldRefs() != null) {
			list.addAll(paramAccessPath2.cloneFieldRefs());
		}
		return new AccessPath(paramAccessPath1.getBase(), list, paramAccessPath1.getCGNode());

	}

	private Set<AccessPath> getFullAccessPaths(AccessPath paramAccessPath, List<Pair<CGNode, Integer>> paramList) {
		Set<AccessPath> hashSet = new HashSet<>();
		CGNode cGNode = paramAccessPath.getCGNode();
		int i = paramAccessPath.getBase();
		Pair<CGNode, Integer> pair = Pair.make(cGNode, i);
		if (paramList.contains(pair)) {
			return hashSet;
		}
		paramList.add(pair);
		if (paramAccessPath.isStatic() || isConstant(cGNode, i)) {
			hashSet.add(paramAccessPath);
			return hashSet;
		}
		DefUse defUse = cGNode.getDU();
		IR iR = cGNode.getIR();
		SSAInstruction sSAInstruction = defUse.getDef(i);
		if (i <= cGNode.getMethod().getNumberOfParameters()
			|| sSAInstruction instanceof com.ibm.wala.ssa.SSANewInstruction) {
			hashSet.add(paramAccessPath);
			return hashSet;
		}
		if (sSAInstruction instanceof SSAInvokeInstruction sSAInvokeInstruction) {
			Set<CGNode> set = this.cg.getPossibleTargets(cGNode, sSAInvokeInstruction.getCallSite());
			for (CGNode cGNode1 : set) {
				Summarys.getInstance().getAPFromSummary(cGNode1, -1).stream()
					.map(ap -> getFullAccessPaths(ap, paramList))
					.reduce(new HashSet<>(), (paramSet1, paramSet2) -> {
						paramSet1.addAll(paramSet2);
						return paramSet1;
					})
					.forEach(ap -> hashSet.add(constructFullAccessPath(ap, paramAccessPath)));
			}
		} else if (sSAInstruction instanceof com.ibm.wala.ssa.SSAGetCaughtExceptionInstruction) {
			IExplodedBasicBlock iExplodedBasicBlock;
			AccessPath accessPath = getAccessPath(cGNode, i);
			if (accessPath != null) {
				for (AccessPath ap : getFullAccessPaths(accessPath, paramList)) {
					hashSet.add(constructFullAccessPath(ap, paramAccessPath));
				}
			}
			ExplodedInterproceduralCFG explodedInterproceduralCFG = this.isg.getICFG();
			ExplodedControlFlowGraph explodedControlFlowGraph = (ExplodedControlFlowGraph) explodedInterproceduralCFG.getCFG(cGNode);
			if (sSAInstruction.iIndex() == -1) {
				iExplodedBasicBlock = explodedControlFlowGraph
					.getBlockForInstruction(iR.getBasicBlockForInstruction(sSAInstruction).getFirstInstructionIndex());
			} else {
				iExplodedBasicBlock = explodedControlFlowGraph.getBlockForInstruction(sSAInstruction.iIndex());
			}

			this.isg.getPredNodes(new BasicBlockInContext<>(cGNode, iExplodedBasicBlock))
				.forEachRemaining(paramBasicBlockInContext -> {
					if (!paramBasicBlockInContext.getNode().equals(cGNode)) {
						Summarys.getInstance().getAPFromSummary(paramBasicBlockInContext.getNode(), -2).stream()
							.map(ap -> getFullAccessPaths(ap, paramList))
							.reduce(new HashSet<>(), (paramSet1, paramSet2) -> {
								paramSet1.addAll(paramSet2);
								return paramSet1;
							})
							.forEach(ap -> hashSet.add(constructFullAccessPath(ap, paramAccessPath)));
					}
				});
		} else if (sSAInstruction instanceof com.ibm.wala.ssa.SSAPhiInstruction) {
			for (int b = 0; b < sSAInstruction.getNumberOfUses(); b++) {
				if (sSAInstruction.getUse(b) >= 0) {
					for (AccessPath ap : getFullAccessPaths(new AccessPath(sSAInstruction.getUse(b), null, cGNode), paramList)) {
						hashSet.add(constructFullAccessPath(ap, paramAccessPath));
					}
				}
			}
		}
		return hashSet;
	}

	public AccessPath getAccessPath(CGNode paramCGNode, int paramInt) {
		Pair<CGNode, Integer> pair = Pair.make(paramCGNode, paramInt);
		return this.value2AP.get(pair);
	}

	public int getAccessPathNumber0fCGNode(CGNode paramCGNode) {
		int count = 0;
		Set<Pair<CGNode, Integer>> set = this.value2AP.keySet();
		for (Pair<CGNode, Integer> pair : set) {
			if (pair.fst.equals(paramCGNode)) {
				count++;
			}
		}
		return count;
	}

	public int getAPNumber() {
		return this.value2AP.size();
	}
}

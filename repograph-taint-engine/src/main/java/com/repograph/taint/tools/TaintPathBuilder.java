package com.repograph.taint.tools;

import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.report.source.LineAndVariable;
import com.repograph.taint.domain.AbstractDomainElement;
import com.repograph.taint.domain.AbstractDomainElement.Info;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.dataflow.IFDS.LocalSummaryEdges;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.dataflow.IFDS.TabulationSolver;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Stack;

import static com.repograph.taint.report.source.SourceJavaLineCacheUtil.getSourceLocation;

public class TaintPathBuilder {

	private static final Logger LOGGER = LoggerFactory.getLogger(TaintPathBuilder.class);
	private static final int DEBUG_LEVEL = 0;

	public static void traceSinglePath(
		AbstractDomainElement de, String appName, Set<List<BugMateInfo>> paths, SolverManager manager,
		TabulationSolver<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> solver)
		throws InvalidClassFileException {
		traceSinglePath(de, new HashSet<>(), new ArrayList<>(), paths, new Stack<>(),
			manager, solver, 0);
	}

	// The best method till now
	// CHECKSTYLE:OFF
	public static void traceSinglePath(
		AbstractDomainElement de, Set<AbstractDomainElement> visited,
		List<BugMateInfo> singlePath, Set<List<BugMateInfo>> paths, Stack<AbstractDomainElement> stack,
		SolverManager manager,
		TabulationSolver<BasicBlockInContext<IExplodedBasicBlock>, CGNode, IDomainElement> solver, double usedTime)
		throws InvalidClassFileException {
		double Threshold = 10; // builderTime * 3
		double beforeTime = System.nanoTime();
		Map<CGNode, LocalSummaryEdges> summaryEdges = solver.summaryEdges;
		visited.add(de);
		stack.push(de);
		List<Info> infos = de.getInfos();

		for (Info info : infos) {
			boolean isSummary = false;
			AbstractDomainElement preDE = info.getPredecessor();
			if (info.getGenInst() instanceof SSAInvokeInstruction) {
				if (info.getPredecessor() != null) {
					CGNode callee = preDE.getCGNode();
					if ((!callee.equals(info.getNode()))
						&& manager.getCallgraph().getPossibleSites(info.getNode(), callee).hasNext()) {
						TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> td = manager.getDomain();
						int d1 = td.getMappedIndex(preDE);
						BasicBlockInContext<IExplodedBasicBlock>[] entries = manager.getICFGSuperGraph()
							.getEntriesForProcedure(callee);
						BasicBlockInContext<IExplodedBasicBlock>[] exits = manager.getICFGSuperGraph()
							.getExitsForProcedure(callee);
						if (entries.length == 1 && exits.length == 1) {
							int entry = solver.getSupergraph().getLocalBlockNumber(entries[0]);
							int exit = solver.getSupergraph().getLocalBlockNumber(exits[0]);
							final LocalSummaryEdges summaries = summaryEdges.get(solver
								.getSupergraph().getProcOf(entries[0]));
							if (summaries != null) {
								IntSet intSet = summaries.getInvertedSummaryEdgesForTarget(entry, exit, d1);
								IntIterator it = intSet.intIterator();
								while (it.hasNext()) {
									AbstractDomainElement start = (AbstractDomainElement) td.getMappedObject(it.next());
									for (Info inf : start.getInfos()) {
										if (inf.getGenInst() == null) {
											continue;
										}
										if (inf.getGenInst().equals(info.getGenInst())
											&& inf.getNode().equals(info.getNode())) {
											if (!stack.contains(inf.getPredecessor())) {
												addPaths(singlePath, info, de);
												isSummary = true;
												traceSinglePath(inf.getPredecessor(), visited, singlePath,
													paths, stack, manager, solver,
													System.nanoTime() - beforeTime + usedTime);
											}
										}
									}
								}
							}
						}
					} else if (!de.getCGNode().equals(info.getNode())) {
						addPaths(singlePath, info, de);
					}
				}
			}
			if (!stack.contains(preDE) && !isSummary) {
				addPaths(singlePath, info, de);

				Set<List<BugMateInfo>> wrap = new HashSet<>();
				wrap.add(singlePath);

				if (sortCorrectMetaPath(wrap, manager).size() == 1) {
					if (preDE == null) {
						paths.add(singlePath);
						return;
					} else {
						double spendTime = (System.nanoTime() - beforeTime + usedTime) / 1E9;
						if (spendTime < Threshold) {
							traceSinglePath(preDE, visited, singlePath, paths, stack, manager, solver,
								System.nanoTime() - beforeTime + usedTime);
						} else {
							LOGGER.error("traceSinglePath build get timeout...");
							return;
						}
						if (paths.size() != 0) {
							return;
						}
					}
				}
			}
		}

		stack.pop();
	}

	// the call site and its return site in a correct path should share same
	// instruction.Use parenthesis matching to judge.
	public static Set<List<BugMateInfo>> sortCorrectMetaPath(
		Set<List<BugMateInfo>> paths, SolverManager manager) {
		Set<List<BugMateInfo>> correctPaths = new HashSet<>();

		for (List<BugMateInfo> list : paths) {
			Stack<Map.Entry<IMethod, String>> stack = new Stack<>();
			boolean correct = true;
			for (int i = 1; i < list.size(); i++) {
				BugMateInfo md = list.get(list.size() - i);
				BugMateInfo nextMd = list.get(list.size() - i - 1);
				if (!md.getMethod().equals(nextMd.getMethod())) {
					if (manager.getCallgraph().getPossibleSites(md.getCgNode(), nextMd.getCgNode()).hasNext()) {
						Map.Entry<IMethod, String> entry = new AbstractMap.SimpleEntry<IMethod, String>(md.getMethod(),
							md.getSsaInstruction().toString());
						// visit call site
						stack.push(entry);
					} else {
						// visit return site
						if (!stack.isEmpty()
							&& (manager.getCallgraph().getPossibleSites(nextMd.getCgNode(), md.getCgNode())
							.hasNext())
							&& (!stack.peek().getValue().contentEquals(nextMd.getSsaInstruction().toString()))) {
							// instruction does not match
							correct = false;
							break;
						} else {
							if (!stack.isEmpty()
								&& (manager.getCallgraph().getPossibleSites(nextMd.getCgNode(), md.getCgNode())
								.hasNext())
								&& (stack.peek().getValue().contentEquals((nextMd.getSsaInstruction().toString()))))
								stack.pop();
						}
					}
				}
			}
			if (correct) {
				correctPaths.add(list);
			}
		}
		return correctPaths;
	}

	private static void addPaths(List<BugMateInfo> singlePath, Info info, AbstractDomainElement de) {
		BugMateInfo metadata = buildMetadata(info, de);
		boolean alreadyAdd = false;
		List<BugMateInfo> needRemove = new ArrayList<>();
		for (BugMateInfo ready : singlePath) {
			if (metadata.getLineNumber() == ready.getLineNumber()) {
				alreadyAdd = true;
				if ((ready.getVariable().isEmpty() || "null".equals(ready.getVariable()))
					&& (!metadata.getVariable().isEmpty() && !"null".equals(metadata.getVariable()))) {
					alreadyAdd = false;
					needRemove.add(ready);
				}
			}
		}
		singlePath.removeAll(needRemove);
		if (!alreadyAdd) {
			singlePath.add(metadata);
		}
	}

	private static BugMateInfo buildMetadata(Info info, AbstractDomainElement de) {
		SSAInstruction genInst = info.getGenInst();
		CGNode node = info.getNode();
		IMethod method = info.getNode().getMethod();

		LineAndVariable sourceLocation = getSourceLocation(node, genInst, de.getValueNumber());
		return BugMateInfo.builder()
			.withBb(de.getSource().block())
			.withMethod(method)
			.withSsaInstruction(genInst)
			.withVariable(sourceLocation.getDefVariableNames())
			.withLineNumber(sourceLocation.getLineNumber())
			.withCgNode(info.getNode())
			.withSsaInstruction(genInst)
			.build();
	}
}

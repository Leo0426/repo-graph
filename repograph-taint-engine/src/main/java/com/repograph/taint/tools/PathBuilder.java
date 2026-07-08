package com.repograph.taint.tools;

import com.repograph.taint.api.report.BugMateInfo;
import com.repograph.taint.domain.AbstractDomainElement;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.shrike.shrikeCT.InvalidClassFileException;
import com.ibm.wala.ssa.SSAInstruction;

import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Stack;

import static com.repograph.taint.extutil.DFAUtils.getSourcePosition;

public class PathBuilder {


	public static void tracePath(AbstractDomainElement de, String appName, Set<List<BugMateInfo>> paths)
		throws InvalidClassFileException {
		tracePath(de, new HashSet<>(), new ArrayList<>(), appName, paths);
	}

	public static void traceMultiPath(AbstractDomainElement de, String appName, Set<List<BugMateInfo>> paths)
		throws InvalidClassFileException {
		traceMultiPath(de, new HashSet<>(), new ArrayList<>(), appName, paths, new Stack<>());
	}

	public static void traceSinglePath(AbstractDomainElement de, String appName, Set<List<BugMateInfo>> paths,
									   SolverManager manager) throws InvalidClassFileException {
		traceSinglePath(de, new HashSet<>(), new ArrayList<>(), appName, paths, new Stack<>(), manager);
	}

	private static void tracePath(AbstractDomainElement de, Set<AbstractDomainElement> visited,
								  List<BugMateInfo> singlePath, String appName, Set<List<BugMateInfo>> paths)
		throws InvalidClassFileException {
		visited.add(de);
		List<AbstractDomainElement.Info> infos = de.getInfos();
		boolean rmVisited = false;
		for (AbstractDomainElement.Info info : infos) {
			List<BugMateInfo> singlePathCopy = new ArrayList<>();
			singlePathCopy.addAll(singlePath);
			int lineNumber = -1;
			String var = "null";
			SSAInstruction genInst = info.getGenInst();
			IMethod method = info.getNode().getMethod();
			IMethod.SourcePosition sp = getSourcePosition(method, genInst == null ? 1 : genInst.iIndex());
			lineNumber = sp == null ? -1 : sp.getLastLine();
			if (sp != null) {
				var = de.getValueName(genInst == null ? 1 : genInst.iIndex() + 1, info);
				var = var == null ? "null" : var;
			}
			BugMateInfo metadata = BugMateInfo.builder()
				.withBb(de.getSource().block())
				.withMethod(method)
				.withVariable(var)
				.withLineNumber(lineNumber)
				.withCgNode(info.getNode())
				.withSsaInstruction(genInst)
				.build();

			singlePathCopy.add(metadata);
			AbstractDomainElement preDE = info.getPredecessor();
			if (preDE == null) {
				paths.add(singlePathCopy);
				rmVisited = true;
			} else if (!visited.contains(preDE)) {
				tracePath(preDE, visited, singlePathCopy, appName, paths);
				rmVisited = true;
			}
		}
		if (rmVisited)
			visited.remove(de);
	}

	private static void traceMultiPath(
		AbstractDomainElement de, Set<AbstractDomainElement> visited,
		List<BugMateInfo> singlePath, String appName, Set<List<BugMateInfo>> paths, Stack<AbstractDomainElement> stack)
		throws InvalidClassFileException {
		visited.add(de);
		stack.push(de);
		List<AbstractDomainElement.Info> infos = de.getInfos();
		for (AbstractDomainElement.Info info : infos) {
			AbstractDomainElement preDE = info.getPredecessor();
			if (!stack.contains(preDE)) {
				List<BugMateInfo> singlePathCopy = new ArrayList<>();
				singlePathCopy.addAll(singlePath);
				int lineNumber = -1;
				String var = "null";
				SSAInstruction genInst = info.getGenInst();
				IMethod method = info.getNode().getMethod();
				IMethod.SourcePosition sp = getSourcePosition(method, genInst == null ? 1 : genInst.iIndex());
				lineNumber = sp == null ? -1 : sp.getLastLine();
				if (sp != null) {
					var = de.getValueName(genInst == null ? 1 : genInst.iIndex() + 1, info);
					var = var == null ? "null" : var;
				}
				BugMateInfo metadata = BugMateInfo.builder()
					.withBb(de.getSource().block())
					.withMethod(method)
					.withVariable(var)
					.withLineNumber(lineNumber)
					.withCgNode(info.getNode())
					.withSsaInstruction(genInst)
					.build();

				singlePathCopy.add(metadata);
				if (preDE == null) {
					paths.add(singlePathCopy);
				} else {
					traceMultiPath(preDE, visited, singlePathCopy, appName, paths, stack);
				}
			}
		}
		stack.pop();

	}

	private static void traceSinglePath(
		AbstractDomainElement de, Set<AbstractDomainElement> visited,
		List<BugMateInfo> singlePath, String appName, Set<List<BugMateInfo>> paths, Stack<AbstractDomainElement> stack,
		SolverManager manager) throws InvalidClassFileException {
		if (!paths.isEmpty()) {
			return;
		}
		visited.add(de);
		stack.push(de);
		List<AbstractDomainElement.Info> infos = de.getInfos();
		for (AbstractDomainElement.Info info : infos) {
			AbstractDomainElement preDE = info.getPredecessor();
			if (!stack.contains(preDE)) {
				List<BugMateInfo> singlePathCopy = new ArrayList<>();
				singlePathCopy.addAll(singlePath);
				int lineNumber = -1;
				String var = "null";
				SSAInstruction genInst = info.getGenInst();
				IMethod method = info.getNode().getMethod();
				IMethod.SourcePosition sp = getSourcePosition(method, genInst == null ? 1 : genInst.iIndex());
				lineNumber = sp == null ? -1 : sp.getLastLine();
				if (sp != null) {
					var = de.getValueName(genInst == null ? 1 : genInst.iIndex() + 1, info);
					var = var == null ? "null" : var;
				}

				BugMateInfo metadata = BugMateInfo.builder()
					.withBb(de.getSource().block())
					.withMethod(method)
					.withVariable(var)
					.withLineNumber(lineNumber)
					.withCgNode(info.getNode())
					.withSsaInstruction(genInst)
					.build();

				singlePathCopy.add(metadata);
				Set<List<BugMateInfo>> wrap = new HashSet<>();
				wrap.add(singlePathCopy);
				if (sortCorrectMetaPath(wrap, manager).size() == 1) {
					if (preDE == null) {
						paths.add(singlePathCopy);
						return;
					} else {
						traceSinglePath(preDE, visited, singlePathCopy, appName, paths, stack, manager);
						if (!paths.isEmpty()) {
							return;
						}
					}
				}
			}
		}
		stack.pop();

	}

	// hard-coded judgment to avoid that the tracing path method enters the 3rd
	// party library or support library
	public static boolean willPathExploded(BugMateInfo md) {
		if (!md.getMethod().toString().contains("Application, Landroid/support/v7/app/")
			&& !md.getMethod().toString().contains("Application, Lcom/facebook/GraphRequest$Serializer")) {
			return false;
		} else {
			return true;
		}
	}

	// the call site and its return site in a correct path should share same
	// instruction.Use parenthesis matching to judge.
	public static Set<List<BugMateInfo>> sortCorrectMetaPath(Set<List<BugMateInfo>> paths,
															 SolverManager manager) {
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
}

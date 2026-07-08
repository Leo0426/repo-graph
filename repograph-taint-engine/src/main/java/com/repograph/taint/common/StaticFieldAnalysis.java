package com.repograph.taint.common;

import com.repograph.taint.api.StaticFieldUse;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.ssa.SSAGetInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SSAPutInstruction;
import com.ibm.wala.types.ClassLoaderReference;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.util.collections.Iterator2Iterable;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.repograph.taint.extutil.DFAUtils.isCommonField;
import static java.util.Objects.isNull;


/**
 * The StaticFieldAnalysis class is used to analyze usages of static fields in a program.
 * It provides methods to determine whether a static field is read, written, or both,
 * within a given call graph and context.
 * <p>
 * The class leverages a cache system to store static field usage information
 * for nodes in the call graph to improve performance.
 * <p>
 * This analysis is particularly useful to perform static field usage checks within the
 * application class loader scope while also respecting constraints such as method
 * abstraction and traversal depth.
 */
public class StaticFieldAnalysis {
	private static StaticFieldAnalysis instance = new StaticFieldAnalysis();
	private final Map<CGNode, Map<FieldReference, StaticFieldUse>> staticFieldUses = new HashMap<>();

	public static StaticFieldAnalysis getInstance() {
		if (instance == null) {
			instance = new StaticFieldAnalysis();
		}
		return instance;
	}

	public static void clear() {
		if (instance != null) {
			instance.staticFieldUses.clear();
			instance = null;
		}
	}

	public boolean isStaticFieldUsed(CallGraph callGraph, CGNode rootNode, FieldReference variable) {
		boolean isAppField = variable.getDeclaringClass().getClassLoader().equals(ClassLoaderReference.Application);
		StaticFieldUse use = checkStaticFieldUsed(callGraph, rootNode, variable, isAppField);
		return (use == StaticFieldUse.READ || use == StaticFieldUse.WRITE
			|| use == StaticFieldUse.READWRITE || use == StaticFieldUse.UNKNOWN);
	}

	public boolean isStaticFieldRead(CallGraph callGraph, CGNode rootNode, FieldReference variable) {
		boolean isAppField = variable.getDeclaringClass().getClassLoader().equals(ClassLoaderReference.Application);
		StaticFieldUse use = checkStaticFieldUsed(callGraph, rootNode, variable, isAppField);
		return (use == StaticFieldUse.READ || use == StaticFieldUse.READWRITE || use == StaticFieldUse.UNKNOWN);
	}

	/**
	 * A constant representing the maximum number of nodes that can be processed
	 * during static field analysis within the {@code StaticFieldAnalysis} class.
	 * This limit is used to prevent excessive processing and potentially infinite
	 * loops during call graph traversal.
	 */
	private static final int MAX_ALLOWED_PROCESSED_NODES = 5;

	private StaticFieldUse checkStaticFieldUsed(CallGraph callGraph, CGNode rootNode,
												FieldReference variable, boolean isAppField) {
		IClassHierarchy cha = callGraph.getClassHierarchy();
		IMethod currentMethod = rootNode.getMethod();

		if (currentMethod.isAbstract()) {
			return StaticFieldUse.UNKNOWN;
		}

		List<CGNode> workList = new ArrayList<>();
		workList.add(rootNode);

		Map<CGNode, StaticFieldUse> tempUses = new HashMap<>();
		int processedNodesCount = 0;

		while (!workList.isEmpty()) {
			CGNode node = workList.remove(workList.size() - 1);

			if (shouldSkipNode(isAppField, node)) {
				continue;
			}

			processedNodesCount++;
			if (node.getMethod().isAbstract() || isNull(node.getIR())) {
				continue;
			}

			if (processedNodesCount > MAX_ALLOWED_PROCESSED_NODES) {
				return StaticFieldUse.UNKNOWN;
			}

			if (checkCachedStaticFieldUses(node, variable, tempUses)) {
				continue;
			}

			StaticFieldUse previousUsage = tempUses.get(node);
			StaticFieldUse currentUsage = analyzeNodeInstructions(callGraph, cha, node, variable, isAppField, tempUses, workList);

			if (currentUsage != previousUsage) {
				tempUses.put(node, currentUsage);
			}
		}

		updateStaticFieldUses(variable, tempUses);

		StaticFieldUse finalUseResult = tempUses.get(rootNode);
		if (finalUseResult == null) {
			return processedNodesCount > MAX_ALLOWED_PROCESSED_NODES ? StaticFieldUse.UNKNOWN : StaticFieldUse.UNUSED;
		}
		return finalUseResult;
	}

	// Primordial and !Application should skip
	private boolean shouldSkipNode(boolean isAppField, CGNode node) {
		return isAppField && node.getMethod().getDeclaringClass().getClassLoader().getReference()
			.equals(ClassLoaderReference.Primordial);
	}

	// 提取检查缓存的 StaticFieldUse
	private boolean checkCachedStaticFieldUses(CGNode node, FieldReference variable,
											   Map<CGNode, StaticFieldUse> tempUses) {
		Map<FieldReference, StaticFieldUse> cachedUses = this.staticFieldUses.get(node);
		if (cachedUses != null) {
			StaticFieldUse cachedUse = cachedUses.get(variable);
			if (cachedUse != null && cachedUse != StaticFieldUse.UNKNOWN) {
				tempUses.put(node, cachedUse);
				return true;
			}
		}
		return false;
	}

	// 提取复杂的分析指令逻辑
	private StaticFieldUse analyzeNodeInstructions(CallGraph callGraph, IClassHierarchy cha,
												   CGNode node,
												   FieldReference variable,
												   boolean isAppField,
												   Map<CGNode, StaticFieldUse> tempUses,
												   List<CGNode> workList) {
		boolean nodeInvocationEncountered = false;
		boolean reads = false;
		boolean writes = false;

		for (SSAInstruction inst : Iterator2Iterable.make(node.getIR().iterateAllInstructions())) {
			if (inst instanceof SSAInvokeInstruction invokeInstr) {
				nodeInvocationEncountered |= processInvokeInstructions(callGraph, invokeInstr, node,
					variable, isAppField, tempUses, workList);
				continue;
			}

			if (inst instanceof SSAGetInstruction getInst && getInst.isStatic()) {
				reads |= processGetInstructions(cha, node, variable, getInst);
				continue;
			}

			if (inst instanceof SSAPutInstruction putInst && putInst.isStatic()) {
				writes |= processPutInstructions(cha, node, variable, putInst);
			}
		}
		return determineStaticFieldUse(reads, writes);
	}

	// 提取 invoke 指令逻辑
	private boolean processInvokeInstructions(CallGraph callGraph, SSAInvokeInstruction invokeInstr,
											  CGNode node, FieldReference variable,
											  boolean isAppField, Map<CGNode, StaticFieldUse> tempUses,
											  List<CGNode> workList) {
		boolean hasInvocation = false;
		for (CGNode callee : callGraph.getPossibleTargets(node, invokeInstr.getCallSite())) {
			if (shouldSkipNode(isAppField, callee) || callee.getMethod().isAbstract())
				continue;

			StaticFieldUse calleeUse = tempUses.get(callee);
			if (calleeUse == null) {
				if (!hasInvocation)
					workList.add(node);
				workList.add(callee);
				hasInvocation = true;
			}
		}
		return hasInvocation;
	}

	// 提取Get指令逻辑
	private boolean processGetInstructions(IClassHierarchy cha, CGNode node, FieldReference targetVariable,
										   SSAGetInstruction getInst) {
		FieldReference fieldRef = getInst.getDeclaredField();
		registerStaticVariableUse(node, fieldRef, StaticFieldUse.READ);
		return isCommonField(cha, targetVariable, fieldRef);
	}

	// 提取Put指令逻辑
	private boolean processPutInstructions(IClassHierarchy cha, CGNode node, FieldReference targetVariable,
										   SSAPutInstruction putInst) {
		FieldReference fieldRef = putInst.getDeclaredField();
		registerStaticVariableUse(node, fieldRef, StaticFieldUse.WRITE);
		return isCommonField(cha, targetVariable, fieldRef);
	}

	// 提取决策最终 StaticFieldUse 的逻辑
	private StaticFieldUse determineStaticFieldUse(boolean reads, boolean writes) {
		if (reads && writes) return StaticFieldUse.READWRITE;
		if (reads) return StaticFieldUse.READ;
		if (writes) return StaticFieldUse.WRITE;
		return StaticFieldUse.UNUSED;
	}

	// 提取更新 StaticFieldUse 缓存的逻辑
	private void updateStaticFieldUses(FieldReference variable, Map<CGNode, StaticFieldUse> tempUses) {
		for (Map.Entry<CGNode, StaticFieldUse> entry : tempUses.entrySet()) {
			registerStaticVariableUse(entry.getKey(), variable, entry.getValue());
		}
	}

	private void registerStaticVariableUse(CGNode node, FieldReference variable, StaticFieldUse fieldUse) {
		StaticFieldUse newUse;
		Map<FieldReference, StaticFieldUse> entry = this.staticFieldUses.get(node);
		if (entry == null) {
			entry = new HashMap<>();
			this.staticFieldUses.put(node, entry);
			entry.put(variable, fieldUse);
			return;
		}
		StaticFieldUse oldUse = entry.get(variable);
		if (oldUse == null) {
			entry.put(variable, fieldUse);
			return;
		}
		newUse = switch (oldUse) {
			case UNKNOWN, UNUSED, READWRITE -> fieldUse;
			case READ -> (fieldUse == StaticFieldUse.READ) ? oldUse : StaticFieldUse.READWRITE;
			case WRITE -> (fieldUse == StaticFieldUse.WRITE) ? oldUse : StaticFieldUse.READWRITE;
		};
		entry.put(variable, newUse);
	}
}

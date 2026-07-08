package com.repograph.taint.npdnorm.ifds.solver;

import com.repograph.taint.TaintAnalysisConfig;
import com.repograph.taint.domain.element.LocalElement;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.annotations.Annotation;

import java.util.*;

/**
 *
 *
 * @author leolu
 * @since 2025/3/10
 */
public class NPDSolverManager extends SolverManager {
	public static int MAX_SOURCES = 2000;
	private final Map<BasicBlockInContext<IExplodedBasicBlock>, Integer> additionalFact = new HashMap<>();
	private final Map<FieldReference, Boolean> fieldTRUEorFALSE = new HashMap<>();
	private final Map<LocalElement, Boolean> methodRetTRUEorFALSE = new HashMap<>();
	private final Map<CGNode, List<BasicBlockInContext<IExplodedBasicBlock>>> visited = new HashMap<>();
	private final Set<String> ignoreFrameworkAnnotationSet = new HashSet<>();
	private final Map<IMethod, Integer> visitedCLintIMethodsFirstly = new HashMap<>();
	private int sourceCount = 0;


	/**
	 * null pointer Dereference manage.
	 */
	public NPDSolverManager(TaintAnalysisConfig config) {
		super(config);
		this.ignoreFrameworkAnnotationSet.add("Lorg/springframework/beans/factory/annotation/Autowired");
		this.ignoreFrameworkAnnotationSet.add("Ljavax/annotation/Resource");
	}

	public boolean isVisitedCLintMethod(BasicBlockInContext<IExplodedBasicBlock> block) {
		int lastInstructionIndex = block.getLastInstruction().iIndex();
		IMethod method = block.getMethod();
		if (this.visitedCLintIMethodsFirstly.containsKey(method)) {
			int recordedIndex = this.visitedCLintIMethodsFirstly.get(method);
			return lastInstructionIndex == recordedIndex;
		} else {
			this.visitedCLintIMethodsFirstly.put(method, lastInstructionIndex);
			return true;
		}
	}

	public boolean ignoreAnnotation(Collection<Annotation> annotations) {
		if (annotations != null && !annotations.isEmpty()) {
			for (Annotation annotation : annotations) {
				if (this.ignoreFrameworkAnnotationSet.contains(annotation.getType().getName().toString())) {
					return true;
				}
			}
		}
		return false;
	}

	public int getSourceCount() {
		return this.sourceCount;
	}

	public void addSourceCount() {
		this.sourceCount++;
	}

	public void addBBVisited(CGNode node, BasicBlockInContext<IExplodedBasicBlock> block) {
		this.visited.computeIfAbsent(node, k -> new LinkedList<>()).add(block);
	}

	public void removeBBVisited(CGNode node, BasicBlockInContext<IExplodedBasicBlock> block) {
		List<BasicBlockInContext<IExplodedBasicBlock>> visitedBlocks = this.visited.get(node);
		if (visitedBlocks != null) {
			visitedBlocks.remove(block);
		}
	}

	public boolean isBBVisited(CGNode node, BasicBlockInContext<IExplodedBasicBlock> block) {
		List<BasicBlockInContext<IExplodedBasicBlock>> visitedBlocks = this.visited.get(node);
		return visitedBlocks != null && visitedBlocks.contains(block);
	}

	public boolean methodRetTRUEorFALSEContains(LocalElement element) {
		return this.methodRetTRUEorFALSE.containsKey(element);
	}

	public Boolean isMethodRetTRUEorFALSE(LocalElement element) {
		return this.methodRetTRUEorFALSE.get(element);
	}

	public void addMethodRetTRUEorFALSE(LocalElement element, Boolean value) {
		if (value != null) {
			this.methodRetTRUEorFALSE.put(element, value);
		}
	}

	public boolean fieldTRUEorFALSEContains(FieldReference field) {
		return this.fieldTRUEorFALSE.containsKey(field);
	}

	public Boolean isFieldTRUEorFALSE(FieldReference field) {
		return this.fieldTRUEorFALSE.get(field);
	}

	public void addFieldTRUEorFALSE(FieldReference field, Boolean value) {
		if (value != null) {
			this.fieldTRUEorFALSE.put(field, value);
		}
	}

	public void addFact(BasicBlockInContext<IExplodedBasicBlock> block, Integer fact) {
		this.additionalFact.put(block, fact);
	}

	public Integer getAdditionalFact(BasicBlockInContext<IExplodedBasicBlock> block) {
		return this.additionalFact.get(block);
	}
}

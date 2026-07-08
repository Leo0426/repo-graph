package com.repograph.taint.solver;

import com.repograph.taint.sourcesink.SourceSinkGroup;
import com.repograph.taint.sourcesink.SourceSinkManager;
import com.repograph.taint.taintWrappers.ITaintPropagationWrapper;
import com.ibm.wala.dataflow.IFDS.ISupergraph;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ipa.cha.IClassHierarchy;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

/**
 * designed for some form of program analysis or security analysis framework.
 * The generic parameters F and T typically represent aspects of flow analysis,
 * like flow features and transfer types
 *
 * @author leolu
 * @since 2024/6/22
 */
public interface ISolverManager<F, T> {

	/**
	 * Retrieves the abstraction domain associated with this analysis.
	 * The domain defines and manages the elements of interprocedural data flow analysis
	 * by mapping abstract flow facts to specific values.
	 *
	 * @return the abstraction domain used in this analysis
	 */
	TabulationDomain<F, T> getDomain();

	/**
	 * Provides the taint propagation wrapper for the analysis.
	 * This wrapper is responsible for defining and controlling how tainted data
	 * propagates through the program during the analysis process.
	 *
	 * @return the taint propagation wrapper
	 */
	ITaintPropagationWrapper<F> getTaintWrapper();

	/**
	 * Retrieves the pointer analysis results.
	 * Pointer analysis is critical for resolving references and pointers within the program,
	 * enabling a deeper understanding of memory usage and references across various points of execution.
	 *
	 * @return the pointer analysis results
	 */
	PointerAnalysis<InstanceKey> getPointerAnalysis();

	/**
	 * Provides the program's call graph representation.
	 * The call graph shows the relationships between different functions or methods in the program,
	 * including all possible calls that may occur during execution.
	 *
	 * @return the program's call graph
	 */
	CallGraph getCallgraph();

	/**
	 * Retrieves the class hierarchy for the program being analyzed.
	 * The class hierarchy represents the structure of classes and interfaces,
	 * including inheritance relationships, facilitating object-oriented analyses.
	 *
	 * @return the class hierarchy
	 */
	IClassHierarchy getClassHierarchy();

	/**
	 * Obtains the forward interprocedural control flow graph (ICFG) for the program.
	 * This graph represents the control flow between methods and procedures in the forward direction,
	 * making it essential for performing interprocedural data flow analysis.
	 *
	 * @return the forward interprocedural control flow graph
	 */
	ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> getICFGSuperGraph();

	/**
	 * Retrieves the backward interprocedural control flow graph (ICFG) of the program.
	 * This graph enables reverse flow analyses, tracing data and control dependencies
	 * back to their sources across procedures.
	 *
	 * @return the backward interprocedural control flow graph
	 */
	ISupergraph<BasicBlockInContext<IExplodedBasicBlock>, CGNode> getBackwardICFGSuperGraph();

	/**
	 * Returns the name of the application being analyzed.
	 * The application name provides a unique identifier for the target program during the analysis process.
	 *
	 * @return the application name
	 */
	String getAppName();

	/**
	 * Provides the type or category of analysis being performed.
	 * The pass kind may denote specific attributes or phases of the analysis process,
	 * aiding in distinguishing between multiple analysis passes.
	 *
	 * @return the type of analysis
	 */
	String getRuleKind();

	/**
	 * Retrieves the SourceSinkManager for the analysis.
	 * This manager defines and maintains sensitive data sources and sinks,
	 * essential for security analyses like taint tracking and identifying vulnerabilities.
	 *
	 * @return the SourceSinkManager object
	 */
	SourceSinkManager getSourceSinkManager();

	/**
	 * Retrieves the currently active SourceSinkGroup.
	 * This group organizes and categorizes related sources and sinks, possibly dividing them by context or functionality,
	 * for more systematic analyses.
	 *
	 * @return the current SourceSinkGroup
	 */
	SourceSinkGroup getCurrentSourceSinkGroup();
}

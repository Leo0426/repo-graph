package com.repograph.taint.solver;

import com.repograph.taint.solver.loader.FieldCFGLoader;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.LoadingCache;
import com.ibm.wala.cfg.ControlFlowGraph;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import org.slf4j.Logger;

import java.util.List;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

public class FieldCFGManager {

	private static final Logger LOGGER = org.slf4j.LoggerFactory.getLogger(FieldCFGManager.class);

	private final LoadingCache<ControlFlowGraph<SSAInstruction, IExplodedBasicBlock>, FieldCFG> fieldCFGCache;

	/**
	 * Constructs a FieldCFGManager to manage cached FieldCFG instances.
	 *
	 * @param manager the SolverManager instance for managing the configuration of field control flow graphs.
	 */
	public FieldCFGManager(SolverManager manager) {
		this.fieldCFGCache = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(30L, TimeUnit.MINUTES)
			.build(new FieldCFGLoader(manager));
	}

	/**
	 * Retrieves the FieldCFG object associated with the given ControlFlowGraph (CFG).
	 * If the requested FieldCFG is not cached, a new instance is loaded into the cache.
	 *
	 * @param cfg the ControlFlowGraph (CFG) for which the FieldCFG is required; must not be null.
	 * @return the FieldCFG corresponding to the provided CFG, or null if an exception occurs.
	 */
	public FieldCFG getFieldCFG(ControlFlowGraph<SSAInstruction, IExplodedBasicBlock> cfg) {
		try {
			return this.fieldCFGCache.get(cfg);
		} catch (ExecutionException exception) {
			LOGGER.error("field cfg get an ExecutionException : {}", exception.getMessage());
		}
		return null;
	}

	/**
	 * Determines the fall-through basic blocks in the FieldCFG corresponding to a given control flow graph (CFG),
	 * node, variable, field, and basic block.
	 *
	 * @param cfg            the ControlFlowGraph (CFG) to query; must not be null.
	 * @param cgNode         the CGNode representing the context of the query; must not be null.
	 * @param var            the variable identifier used in the query.
	 * @param fieldReference the field reference providing additional field context for the query; must not be null.
	 * @param bb             the basic block within the CFG from which fall-throughs are calculated.
	 * @return a list of fall-through IExplodedBasicBlock(s), or {@code null} if an exception occurs.
	 */
	public List<IExplodedBasicBlock> getFieldFallThroughTo(
		ControlFlowGraph<SSAInstruction, IExplodedBasicBlock> cfg,
		CGNode cgNode, int var, FieldReference fieldReference, IExplodedBasicBlock bb) {
		try {
			FieldCFG fieldCFG = this.fieldCFGCache.get(cfg);
			return fieldCFG.getFallThroughTo(cgNode, var, fieldReference, bb);
		} catch (ExecutionException exception) {
			LOGGER.error("fall through get an exception : {}", exception.getMessage());
		}
		return null;
	}

}

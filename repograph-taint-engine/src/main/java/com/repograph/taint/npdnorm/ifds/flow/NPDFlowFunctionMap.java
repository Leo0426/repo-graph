package com.repograph.taint.npdnorm.ifds.flow;

import com.repograph.taint.common.BlockPair;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import com.ibm.wala.dataflow.IFDS.IFlowFunction;
import com.ibm.wala.dataflow.IFDS.IPartiallyBalancedFlowFunctions;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.TimeUnit;


/**
 * sparse npd function flow methods.
 *
 * @author leo
 * @since 2024/11/27
 */
public class NPDFlowFunctionMap implements IPartiallyBalancedFlowFunctions<BasicBlockInContext<IExplodedBasicBlock>> {

	private static final Logger LOGGER = LoggerFactory.getLogger(NPDFlowFunctionMap.class);

	private final SolverManager solverManager;
	private final PropagationRuleManager propagationRuleManager;

	private final LoadingCache<BlockPair<IExplodedBasicBlock>, IUnaryFlowFunction> normalFlowFunctions;
	private final LoadingCache<BlockPair<IExplodedBasicBlock>, IUnaryFlowFunction> callToReturnFlowFunctionCache;
	private final LoadingCache<BlockPair<IExplodedBasicBlock>, IUnaryFlowFunction> callNoneToReturnFlowFunctionCache;
	private final LoadingCache<BlockPair<IExplodedBasicBlock>, IUnaryFlowFunction> callFlowFunctionCache;

	public NPDFlowFunctionMap(SolverManager solverManager, PropagationRuleManager propagationRuleManager) {
		this.solverManager = solverManager;
		this.propagationRuleManager = propagationRuleManager;

		this.normalFlowFunctions = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10L, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public IUnaryFlowFunction load(BlockPair<IExplodedBasicBlock> key) {
					return new NullPointFlowFunction(solverManager, propagationRuleManager, key.fst, key.snd);
				}
			});

		callFlowFunctionCache = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10L, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public IUnaryFlowFunction load(BlockPair<IExplodedBasicBlock> key) {
					return new NullPointCallFlowFunction(solverManager, propagationRuleManager, key.fst, key.snd);
				}
			});

		callToReturnFlowFunctionCache = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10L, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public IUnaryFlowFunction load(BlockPair<IExplodedBasicBlock> key) {
					return new NullPointCallToReturnFlowFunction(solverManager, propagationRuleManager, key.fst, key.snd);
				}
			});

		callNoneToReturnFlowFunctionCache = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10L, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public IUnaryFlowFunction load(BlockPair<IExplodedBasicBlock> key) {
					return new NullPointCallNoneToReturnFlowFunction(solverManager, propagationRuleManager, key.fst, key.snd);
				}
			});
	}

	@Override
	public IUnaryFlowFunction getNormalFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
													BasicBlockInContext<IExplodedBasicBlock> dest) {
		try {
			return this.normalFlowFunctions.get(new BlockPair<>(src, dest));
		} catch (Exception e) {
			LOGGER.error("npe normal flow get an exception: {}", e.getMessage());
		}
		return null;
	}

	@Override
	public IUnaryFlowFunction getCallFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
												  BasicBlockInContext<IExplodedBasicBlock> dest,
												  BasicBlockInContext<IExplodedBasicBlock> ret) {
		try {
			return this.callFlowFunctionCache.get(new BlockPair<>(src, dest));
		} catch (Exception e) {
			LOGGER.error("npd call flow get an exception: {}", e.getMessage());
		}
		return null;
	}

	@Override
	public IFlowFunction getReturnFlowFunction(BasicBlockInContext<IExplodedBasicBlock> call,
											   BasicBlockInContext<IExplodedBasicBlock> src,
											   BasicBlockInContext<IExplodedBasicBlock> dest) {
		return new NullPointReturnFlowFunction(this.solverManager, propagationRuleManager, call, src, dest);
	}

	@Override
	public IUnaryFlowFunction getCallToReturnFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
														  BasicBlockInContext<IExplodedBasicBlock> dest) {
		try {
			return this.callToReturnFlowFunctionCache.get(new BlockPair<>(src, dest));
		} catch (Exception e) {
			LOGGER.error("npd call to return flow get an exception: {}", e.getMessage());
		}
		return null;
	}

	@Override
	public IUnaryFlowFunction getCallNoneToReturnFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
															  BasicBlockInContext<IExplodedBasicBlock> dest) {
		try {
			return this.callNoneToReturnFlowFunctionCache.get(new BlockPair<>(src, dest));
		} catch (Exception e) {
			LOGGER.error("npd call none to return flow get an exception: {}", e.getMessage());
		}
		return null;
	}

	@Override
	public IFlowFunction getUnbalancedReturnFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
														 BasicBlockInContext<IExplodedBasicBlock> dest) {
		return new NPDUnbalanceFlowFunction(solverManager, propagationRuleManager, src, dest);
	}
}

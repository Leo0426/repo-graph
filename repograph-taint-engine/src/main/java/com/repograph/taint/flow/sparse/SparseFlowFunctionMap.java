package com.repograph.taint.flow.sparse;

import com.repograph.taint.common.BlockPair;
import com.repograph.taint.flow.CallFlowFunction;
import com.repograph.taint.flow.CallNoneToReturnFlowFunction;
import com.repograph.taint.flow.CallToReturnFlowFunction;
import com.repograph.taint.flow.ReturnFlowFunction;
import com.repograph.taint.flow.UnbalancedReturnFlowFunction;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import com.ibm.wala.dataflow.IFDS.IFlowFunction;
import com.ibm.wala.dataflow.IFDS.IPartiallyBalancedFlowFunctions;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.ISSABasicBlock;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.SparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.TimeUnit;

public class SparseFlowFunctionMap<E extends ISSABasicBlock>
	implements IPartiallyBalancedFlowFunctions<BasicBlockInContext<IExplodedBasicBlock>> {

	public static final IntSet ZERO_SET = SparseIntSet.singleton(0);
	private static final Logger LOGGER = LoggerFactory.getLogger(SparseFlowFunctionMap.class);
	private final SolverManager solverManager;
	private final PropagationRuleManager propagationRuleManager;

	private final LoadingCache<BlockPair<IExplodedBasicBlock>, IUnaryFlowFunction> normalFlowFunctions;
	private final LoadingCache<BlockPair<IExplodedBasicBlock>, IUnaryFlowFunction> callToReturnFlowFunctionCache;
	private final LoadingCache<BlockPair<IExplodedBasicBlock>, IUnaryFlowFunction> callNoneToReturnFlowFunctionCache;
	private final LoadingCache<BlockPair<IExplodedBasicBlock>, IUnaryFlowFunction> callFlowFunctionCache;

	public SparseFlowFunctionMap(SolverManager solverManager, PropagationRuleManager propagationRuleManager) {

		this.solverManager = solverManager;
		this.propagationRuleManager = propagationRuleManager;


		normalFlowFunctions = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10L, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public IUnaryFlowFunction load(BlockPair<IExplodedBasicBlock> key) {
					return new SparseNormalFlowFunction(solverManager, propagationRuleManager, key.fst, key.snd);
				}
			});

		callFlowFunctionCache = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10L, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public IUnaryFlowFunction load(BlockPair<IExplodedBasicBlock> key) {
					if (!solverManager.getICFGSuperGraph().isCall(key.fst)) {
						throw new AssertionError("taint call flow get an exception : " + key.fst.toString());
					} else {
						return new CallFlowFunction(solverManager, propagationRuleManager, key.fst, key.snd);
					}
				}
			});

		callToReturnFlowFunctionCache = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10L, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public IUnaryFlowFunction load(BlockPair<IExplodedBasicBlock> key) throws Exception {
					return new CallToReturnFlowFunction(solverManager, propagationRuleManager, key.fst, key.snd);
				}
			});

		callNoneToReturnFlowFunctionCache = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10L, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public IUnaryFlowFunction load(BlockPair<IExplodedBasicBlock> key) throws Exception {
					return new CallNoneToReturnFlowFunction(solverManager, propagationRuleManager, key.fst, key.snd);
				}
			});


	}

	@Override
	public IUnaryFlowFunction getNormalFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
													BasicBlockInContext<IExplodedBasicBlock> dest) {
		try {
			return this.normalFlowFunctions.get(new BlockPair<>(src, dest));
		} catch (Exception e) {
			LOGGER.error("taint normal flow get an exception : {} ", e.getMessage());
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
			LOGGER.error("taint call flow get an exception : {} ", e.getMessage());
		}
		return null;
	}

	@Override
	public IFlowFunction getReturnFlowFunction(BasicBlockInContext<IExplodedBasicBlock> call,
											   BasicBlockInContext<IExplodedBasicBlock> src,
											   BasicBlockInContext<IExplodedBasicBlock> dest) {
		return new ReturnFlowFunction(solverManager, propagationRuleManager, call, src, dest);
	}

	@Override
	public IUnaryFlowFunction getCallToReturnFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
														  BasicBlockInContext<IExplodedBasicBlock> dest) {
		try {
			return this.callToReturnFlowFunctionCache.get(new BlockPair<>(src, dest));
		} catch (Exception e) {
			LOGGER.error("taint call to return flow get an exception : {} ", e.getMessage());
		}
		return null;
	}

	@Override
	public IUnaryFlowFunction getCallNoneToReturnFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
															  BasicBlockInContext<IExplodedBasicBlock> dest) {
		try {
			return this.callNoneToReturnFlowFunctionCache.get(new BlockPair<>(src, dest));
		} catch (Exception e) {
			LOGGER.error("taint call none to return get an exception : {} ", e.getMessage());
		}
		return null;
	}

	@Override
	public IFlowFunction getUnbalancedReturnFlowFunction(BasicBlockInContext<IExplodedBasicBlock> src,
														 BasicBlockInContext<IExplodedBasicBlock> dest) {
		return new UnbalancedReturnFlowFunction(solverManager, propagationRuleManager, src, dest);
	}

	public void clear() {
		this.normalFlowFunctions.cleanUp();
	}
}

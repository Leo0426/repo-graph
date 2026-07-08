package com.repograph.taint.common;

import com.repograph.taint.domain.IDomainElement;
import com.google.common.cache.CacheBuilder;
import com.google.common.cache.CacheLoader;
import com.google.common.cache.LoadingCache;
import com.ibm.wala.cfg.ControlFlowGraph;
import com.ibm.wala.dataflow.IFDS.ICFGSupergraph;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.collections.Iterator2Collection;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

import static com.repograph.taint.extutil.DFAUtils.sameMethod;


/**
 * The CallSiteFinder class is responsible for locating call sites within an ICFGSupergraph.
 * It uses a caching mechanism to efficiently retrieve and compute call sites based on the
 * provided parameters.
 * <p>
 * This class is implemented as a singleton to ensure a single instance operates throughout
 * the program. It provides functionality for constructing, caching, and retrieving call sites
 * for various inter-procedural and intra-procedural cases.
 * <p>
 * The key functionalities include:
 * - Managing the singleton lifecycle of CallSiteFinder.
 * - Caching call site results for efficient future lookups.
 * - Computing call sites for different cases, such as exit blocks, exception catch blocks,
 * and inter-procedural scenarios.
 *
 * @author leolu
 * @version 1.0
 * @since 2025/3/7
 */
public class CallSiteFinder {
	private static volatile CallSiteFinder instance;
	private final ICFGSupergraph isg;
	private LoadingCache<Triplet<BasicBlockInContext<IExplodedBasicBlock>,
		BasicBlockInContext<IExplodedBasicBlock>, IDomainElement>,
		Set<BasicBlockInContext<IExplodedBasicBlock>>> callSiteCache;

	private CallSiteFinder(ICFGSupergraph isg) {
		this.isg = isg;
		this.callSiteCache = CacheBuilder.newBuilder()
			.maximumSize(10000L)
			.expireAfterWrite(10, TimeUnit.MINUTES)
			.build(new CacheLoader<>() {
				@Override
				public Set<BasicBlockInContext<IExplodedBasicBlock>> load(Triplet<BasicBlockInContext<IExplodedBasicBlock>,
					BasicBlockInContext<IExplodedBasicBlock>, IDomainElement> triplet) {
					return buildAllCallSite(triplet);
				}
			});
	}

	public static CallSiteFinder getInstance(ICFGSupergraph isg) {
		if (instance == null) {
			synchronized (CallSiteFinder.class) {
				if (instance == null) {
					instance = new CallSiteFinder(isg);
				}
			}
		}
		return instance;
	}

	public static void clearInstance() {
		if (instance != null) {
			synchronized (CallSiteFinder.class) {
				if (instance != null) {
					instance.callSiteCache.invalidateAll();
					instance.callSiteCache = null;
					instance = null;
				}
			}
		}
	}

	private Set<BasicBlockInContext<IExplodedBasicBlock>> buildAllCallSite(
		Triplet<BasicBlockInContext<IExplodedBasicBlock>, BasicBlockInContext<IExplodedBasicBlock>, IDomainElement> triplet) {

		BasicBlockInContext<IExplodedBasicBlock> exitBB = triplet.fst();
		BasicBlockInContext<IExplodedBasicBlock> retBB = triplet.snd();
		IDomainElement de = triplet.third();

		if (!this.isg.isExit(exitBB)) {
			throw new AssertionError("type mismatch");
		}

		if (retBB.isExitBlock()) {
			return findExitCallSites(retBB, exitBB);
		} else if (retBB.isCatchBlock() && de.isExceptionType()) {
			return Iterator2Collection.toSet(this.isg.getCallSites(retBB, exitBB.getNode()));
		} else {
			return Iterator2Collection.toSet(this.isg.getICFG().getCallSites(retBB, exitBB.getNode()));
		}
	}

	private Set<BasicBlockInContext<IExplodedBasicBlock>> findExitCallSites(
		BasicBlockInContext<IExplodedBasicBlock> retBB, BasicBlockInContext<IExplodedBasicBlock> exitBB) {

		Set<BasicBlockInContext<IExplodedBasicBlock>> res = new HashSet<>();
		ControlFlowGraph<SSAInstruction, IExplodedBasicBlock> cfg = this.isg.getCFG(retBB);

		//TODO: need fixed
		if (cfg.exit().getMethod().getSelector().toString().equals("fakeRootMethod()V")) {
			return res;
		}

		cfg.getNormalPredecessors(cfg.exit())
			.forEach((normalPre) -> {
				SSAInstruction invoke = normalPre.getInstruction();
				if (invoke instanceof SSAInvokeInstruction
					&& sameMethod(this.isg.getClassHierarchy(),
					((SSAInvokeInstruction) invoke).getDeclaredTarget(),
					exitBB.getNode().getMethod().getReference())) {
					res.add(new BasicBlockInContext<>(retBB.getNode(), normalPre));
				}
			});
		return res;
	}

	public Set<BasicBlockInContext<IExplodedBasicBlock>> getAllCallSite(
		BasicBlockInContext<IExplodedBasicBlock> exitBB,
		BasicBlockInContext<IExplodedBasicBlock> retBB, IDomainElement de) throws ExecutionException {
		return this.callSiteCache.get(new Triplet<>(exitBB, retBB, de));
	}

}

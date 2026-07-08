package com.repograph.taint.flow.sparse;

import com.repograph.taint.Engine;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.flow.sparse.util.SparseTaintUtil;
import com.repograph.taint.flow.vistor.NormalFlowFunctionSparseVisitor;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import com.ibm.wala.util.intset.SparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import static com.repograph.taint.Engine.evaluateBeforeCoreInst;

/**
 * 稀疏污点传播中的普通传播函数（Normal Flow Function）
 */
public class SparseNormalFlowFunction implements IUnaryFlowFunction {

	private static final int IDENTITY = 0;
	private final Logger LOGGER = LoggerFactory.getLogger(SparseNormalFlowFunction.class);

	private final BasicBlockInContext<IExplodedBasicBlock> src;
	private final BasicBlockInContext<IExplodedBasicBlock> dest;
	private final SolverManager solverManager;
	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;

	public SparseNormalFlowFunction(SolverManager solverManager, PropagationRuleManager ruleManager,
									BasicBlockInContext<IExplodedBasicBlock> src,
									BasicBlockInContext<IExplodedBasicBlock> dest) {
		this.solverManager = solverManager;
		this.domain = solverManager.getDomain();
		this.src = src;
		this.dest = dest;
	}

	@Override
	public IntSet getTargets(int d1) {
		MutableSparseIntSet result = MutableSparseIntSet.makeEmpty();
		// Step 1: 初始种子传播（只有在非 summary pass 且是 source 才处理）
//		if (LOGGER.isDebugEnabled()) {
//			IR ir = src.getNode().getIR();
//			if (ir != null && ir.getMethod().getDeclaringClass().getClassLoader().getReference().equals(ClassLoaderReference.Application)) {
//				LOGGER.debug("sparse normal flow , method : {} src :{} line : {}", src.getMethod(), src.getLastInstruction(), DFAUtils.getSourcePosition(src.getMethod(), src.getLastInstructionIndex()));
//			}
//		}
		if (d1 == IDENTITY) {
			if (!solverManager.getSources().contains(src)) {
				return SparseIntSet.singleton(0);
			}

			int newSeed = SparseTaintUtil.createStaticPutDomainElement(domain, src);
			if (newSeed >= 0) {
				result.add(newSeed);
			}
		}


		// Step 2: 正常传播逻辑
		result.addAll(computeNormalFlow(src, d1));
		return result;
	}

	private IntSet computeNormalFlow(BasicBlockInContext<IExplodedBasicBlock> block, int fact) {
		MutableSparseIntSet finalResult = MutableSparseIntSet.makeEmpty();

		// 前置传播（core 语句前）
		NormalFlowFunctionSparseVisitor visitor = new NormalFlowFunctionSparseVisitor(solverManager, fact, src, dest);
		MutableSparseIntSet beforeInst = evaluateBeforeCoreInst(block, fact, visitor);
		beforeInst.foreach(f -> {
			if (f != fact) finalResult.add(f);
		});

		// 指令级传播
		SSAInstruction inst = block.getLastInstruction();
		MutableSparseIntSet duringInst = MutableSparseIntSet.makeEmpty();
		if (inst != null) {
			for (IntIterator it = beforeInst.intIterator(); it.hasNext(); ) {
				int currentFact = it.next();
				visitor = new NormalFlowFunctionSparseVisitor(solverManager, currentFact, src, dest);
				inst.visit(visitor);
				duringInst.addAll(visitor.getIntSet());
			}
		} else {
			duringInst.addAll(beforeInst);
		}

		duringInst.foreach(f -> {
			if (f != fact) finalResult.add(f);
		});

		for (IntIterator it = duringInst.intIterator(); it.hasNext(); ) {
			int midFact = it.next();
			visitor = new NormalFlowFunctionSparseVisitor(solverManager, midFact, src, dest);
			IntSet afterInst = Engine.evaluateAfterCoreInst(block, midFact, visitor);
			finalResult.addAll(afterInst);
		}

		return finalResult;
	}
}

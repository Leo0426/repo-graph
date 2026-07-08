/*
 *
 * MIT License
 *
 * Copyright (c) 2023 Leo Lu.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */

package com.repograph.taint.flow;

import com.repograph.taint.api.IContext;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.flow.sparse.util.SparseTaintUtil;
import com.repograph.taint.flow.vistor.NormalFlowFunctionVisitor;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static com.repograph.taint.Engine.evaluateBeforeCoreInst;

/**
 * is responsible for handling unary flow functions in a data flow analysis context,
 * with a focus on static field analysis and propagation rules.
 *
 * @author junle
 * @since 2024/8/18
 */
public class CallToReturnFlowFunction implements IUnaryFlowFunction {

	private final PropagationRuleManager propagationRuleManager;
	private final CGNode cgNode;
	private final BasicBlockInContext<IExplodedBasicBlock> src;
	private final BasicBlockInContext<IExplodedBasicBlock> dest;
	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;
	private final SolverManager solverManager;

	private final IContext context = GlobalCache.INSTANCE.getDefault();

	/**
	 * Constructor to initialize the flow function handler with necessary context.
	 *
	 * @param solverManager          the solver manager providing analysis context
	 * @param propagationRuleManager the manager for propagation rules
	 */
	public CallToReturnFlowFunction(SolverManager solverManager,
									PropagationRuleManager propagationRuleManager,
									BasicBlockInContext<IExplodedBasicBlock> src,
									BasicBlockInContext<IExplodedBasicBlock> dest) {
		this.solverManager = solverManager;
		this.cgNode = src.getNode();
		this.src = src;
		this.dest = dest;
		this.domain = solverManager.getDomain();
		this.propagationRuleManager = propagationRuleManager;
	}

	@Override
	public IntSet getTargets(int d1) {
		MutableSparseIntSet resultSet = MutableSparseIntSet.makeEmpty();

		// Handle initial fact
		if (d1 == 0) {
			if (!context.getCheckConfig().isUnbalancedOn()) {
				resultSet.add(0);
			}
			if (!context.getRule().getCurrentRuleName().equals("SUMMARY") && this.solverManager.getSources().contains(this.src)) {
				Set<Integer> sourceParaIdx = this.solverManager.getSourceSinkManager()
					.getSourceParaIdx(this.solverManager.getClassHierarchy(), ((SSAInvokeInstruction) this.src.getDelegate().getInstruction()).getDeclaredTarget());
				for (Integer paraIdx : sourceParaIdx) {
					if (paraIdx == -1) {
						int idxInDomain = SparseTaintUtil.createReturnDomainElement(domain, src);
						resultSet.add(idxInDomain);
						break;
					}
				}
			}
		} else {

			NormalFlowFunctionVisitor evaluator = new NormalFlowFunctionVisitor(this.solverManager, d1, this.src, this.dest);
			MutableSparseIntSet intSet = evaluateBeforeCoreInst(this.src, d1, evaluator);
			if (propagationRuleManager.canProcess(d1, this.src)) {
				IntIterator intIterator = intSet.intIterator();
				while (intIterator.hasNext()) {
					int currentD = intIterator.next();
					IntSet intSet1 = this.propagationRuleManager.applyCallToReturnFlowFunction(currentD, this.src);
					if (!intSet1.isEmpty()) {
						resultSet.addAll(intSet1);
					}
				}
			} else {
				MutableSparseIntSet sparseIntSet = MutableSparseIntSet.makeEmpty();
				sparseIntSet.addAll(intSet);
				sparseIntSet.foreach(x -> {
					IDomainElement ele = domain.getMappedObject(d1);
					if (ele instanceof DomainElement domainElement) {
						AccessPath ap = domainElement.getAccessPath();
						int baseVar = ap.getBase();
						SSAInstruction inst = this.src.getLastInstruction();
						if (!(inst instanceof SSAInvokeInstruction invokeInst)) {
							throw new AssertionError("Expected invoke instruction.");
						}

						if (!DFAUtils.containUse(inst, baseVar)) {
							MethodReference targetMethod = invokeInst.getDeclaredTarget();
							boolean matchFound = false;

							for (int i = 0; i < invokeInst.getNumberOfUses(); i++) {
								int var = invokeInst.getUse(i);
								int paramIndex = invokeInst.isStatic() ? i : i - 1;

								if (paramIndex < 0) continue;

								// 跳过基础类型或 String 类型
								if (targetMethod.getParameterType(paramIndex).isPrimitiveType()
									|| targetMethod.getParameterType(paramIndex).getName().toString().equals("Ljava/lang/String")) {
									continue;
								}

								// 字段匹配判断：是否 AccessPath 可从当前参数传播
								Set<List<FieldReference>> fieldSuffix = new HashSet<>();
								if (SparseTaintUtil.matchAccessPath(this.cgNode, var, ap, fieldSuffix)) {
									matchFound = true;
									break;
								}
							}

							if (!matchFound) {
								sparseIntSet.add(d1);
							}

						} else {
							for (int i = invokeInst.isStatic() ? 0 : 1; i < inst.getNumberOfUses(); i++) {
								int var = inst.getUse(i);
								int paramIndex = invokeInst.isStatic() ? i : i - 1;

								if (var == baseVar && invokeInst.getDeclaredTarget().getParameterType(paramIndex).isPrimitiveType()) {
									sparseIntSet.add(d1);
									break;
								}
							}
						}
					}
				});
			}
		}
		return resultSet;
	}
}

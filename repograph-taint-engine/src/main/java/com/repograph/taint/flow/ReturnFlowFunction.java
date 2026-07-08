package com.repograph.taint.flow;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.sourcesink.KillManager;
import com.repograph.taint.common.Selectors;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.flow.sparse.SparseFlowFunctionMap;
import com.repograph.taint.flow.sparse.util.SparseTaintUtil;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAGetCaughtExceptionInstruction;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.repograph.taint.api.DomainElementType.NORMAL;

public class ReturnFlowFunction implements IUnaryFlowFunction {

	private final BasicBlockInContext<IExplodedBasicBlock> call;
	private final BasicBlockInContext<IExplodedBasicBlock> src;
	private final BasicBlockInContext<IExplodedBasicBlock> dest;
	private final IMethod method;
	private final Map<Integer, Integer> paramToUseMap;
	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;
	private final SSAInvokeInstruction invokeInstruction;
	private final KillManager killManager;

	public ReturnFlowFunction(SolverManager solverManager,
							  PropagationRuleManager propagationRuleManager,
							  BasicBlockInContext<IExplodedBasicBlock> call,
							  BasicBlockInContext<IExplodedBasicBlock> src,
							  BasicBlockInContext<IExplodedBasicBlock> dest) {
		this.killManager = solverManager.getKillManager();
		this.domain = solverManager.getDomain();
		this.call = call;
		this.src = src;
		this.method = src.getMethod();
		this.dest = dest;

		SSAInstruction lastInstruction = call.getLastInstruction();
		if (!(lastInstruction instanceof SSAInvokeInstruction)) {
			throw new AssertionError("Expected SSAInvokeInstruction");
		}

		if (!src.isExitBlock()) {
			throw new AssertionError("Expected an exit block");
		}

		this.invokeInstruction = (SSAInvokeInstruction) lastInstruction;
		int numParams = this.method.getNumberOfParameters();
		this.paramToUseMap = new HashMap<>();
		int numUses = lastInstruction.getNumberOfUses();
		for (int i = 0; i < numParams; ++i) {
			if (i < numUses) {
				this.paramToUseMap.put(i + 1, lastInstruction.getUse(i));
			}
		}
	}

	@Override
	public IntSet getTargets(int d1) {
		if (d1 == 0) {
			return SparseFlowFunctionMap.ZERO_SET;
		} else {
			MutableSparseIntSet resultSet = MutableSparseIntSet.makeEmpty();
			DomainElement domainElement = (DomainElement) this.domain.getMappedObject(d1);
			AccessPath accessPath = domainElement.getAccessPath();
			if (accessPath.isStatic()) {
				resultSet.add(d1);
			} else if (domainElement.isReturnType()) {
				handleReturnType(domainElement, accessPath, resultSet);
			} else if (domainElement.isExceptionType()) {
				handleExceptionType(domainElement, accessPath, resultSet);
			} else {
				handleNormalType(domainElement, accessPath, resultSet);
			}
			return resultSet;
		}
	}

	private void handleReturnType(DomainElement domainElement, AccessPath accessPath, MutableSparseIntSet resultSet) {
		if (!this.killManager.needKillReturnValue(this.method.getSignature()) && this.invokeInstruction.getNumberOfReturnValues() > 0) {
			int def = this.invokeInstruction.getDef();
			AccessPath newPath = new AccessPath(def, accessPath.cloneFieldRefs(), this.dest.getNode());
			int newFact = this.domain.add(
				new DomainElement(this.call.getNode(), newPath, domainElement.getSource(),
					NORMAL, this.call.getDelegate().getInstruction(), domainElement));
			resultSet.add(newFact);
		}
	}

	private void handleExceptionType(DomainElement domainElement, AccessPath accessPath, MutableSparseIntSet resultSet) {
		if (this.dest.isExitBlock()) {
			AccessPath newPath = new AccessPath(accessPath.getBase(), accessPath.cloneFieldRefs(), this.dest.getNode());
			int newFact = this.domain.add(new DomainElement(this.call.getNode(), newPath, domainElement.getSource(),
				DomainElementType.EXCEPTION, this.call.getDelegate().getInstruction(), domainElement));
			resultSet.add(newFact);
		} else if (this.dest.isCatchBlock()) {
			SSAGetCaughtExceptionInstruction catchInstruction = this.dest.getDelegate().getCatchInstruction();
			if (catchInstruction != null) {
				int exception = catchInstruction.getException();
				AccessPath newPath = new AccessPath(exception, accessPath.cloneFieldRefs(), this.dest.getNode());
				resultSet.add(this.domain.add(
					new DomainElement(this.call.getNode(), newPath, domainElement.getSource(),
						NORMAL, this.src.getDelegate().getInstruction(), domainElement)));
			}
		}
	}

	private void handleNormalType(DomainElement domainElement, AccessPath accessPath, MutableSparseIntSet resultSet) {
		if ((Selectors.isSpecialEdge(this.invokeInstruction.getDeclaredTarget().getSelector(), this.src.getMethod().getSelector())
			|| !this.paramToUseMap.containsKey(accessPath.getBase())
			|| !this.method.getParameterType(accessPath.getBase() - 1).isReferenceType())
			&& (accessPath.getBase() > 1 || !this.paramToUseMap.containsKey(accessPath.getBase()))) {
			Set<AccessPath> accessPaths = SparseTaintUtil.getParameterAccessPaths(src.getNode(), accessPath.getBase());
			for (AccessPath path : accessPaths) {
				this.paramToUseMap.get(path.getBase());
				int i;
				if (Selectors.isSpecialEdge(this.invokeInstruction.getDeclaredTarget().getSelector(), this.src.getMethod().getSelector()) && path.getBase() == 1) {
					if (this.invokeInstruction.isStatic()) {
						i = this.invokeInstruction.getUse(0);
					} else {
						i = this.invokeInstruction.getUse(1);
					}
					List<FieldReference> fieldReferences = path.cloneFieldRefs();
					fieldReferences.addAll(accessPath.cloneFieldRefs());
					AccessPath accessPath1 = new AccessPath(i, fieldReferences, this.dest.getNode());
					int add = this.domain.add(new DomainElement(this.call.getNode(), accessPath1, domainElement.getSource(), NORMAL, this.call.getDelegate().getInstruction(), domainElement));
					resultSet.add(add);
				}
			}
		} else {
			if (Selectors.isSpecialEdge(this.invokeInstruction.getDeclaredTarget().getSelector(), this.src.getMethod().getSelector()) && accessPath.getBase() == 1) {
				int i;
				if (this.invokeInstruction.isStatic()) {
					i = this.invokeInstruction.getUse(0);
				} else {
					i = this.invokeInstruction.getUse(1);
				}
				AccessPath accessPath1 = new AccessPath(i, accessPath.cloneFieldRefs(), this.dest.getNode());
				int add = this.domain.add(new DomainElement(this.call.getNode(), accessPath1, domainElement.getSource(), NORMAL, this.call.getDelegate().getInstruction(), domainElement));
				resultSet.add(add);

			}
		}
	}
}

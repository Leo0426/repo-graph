package com.repograph.taint.flow;

import com.repograph.taint.sourcesink.KillManager;
import com.repograph.taint.common.Selectors;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.flow.sparse.SparseFlowFunctionMap;
import com.repograph.taint.flow.sparse.util.SparseTaintUtil;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.extutil.DFAUtils;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.repograph.taint.api.DomainElementType.EXCEPTION;
import static com.repograph.taint.api.DomainElementType.NORMAL;

public class AssistFlowFunction implements IUnaryFlowFunction {

	private static final Logger LOGGER = LoggerFactory.getLogger(AssistFlowFunction.class);

	private static final int DEFAULT_PARAM = 0;

	private final BasicBlockInContext<IExplodedBasicBlock> call;
	private final BasicBlockInContext<IExplodedBasicBlock> src;
	private final BasicBlockInContext<IExplodedBasicBlock> dest;

	private final IMethod method;

	private final Map<Integer, Integer> paramMapping;

	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;

	private final SSAInvokeInstruction invokeInstruction;

	private final KillManager killManager;

	/**
	 * Constructs an AssistFlowFunction for the provided call, source, and destination blocks.
	 *
	 * @param solverManager          The solver manager that provides utilities related to taint analysis.
	 * @param propagationRuleManager The propagation rule manager for handling propagation rules.
	 * @param call                   The call block where the flow function is invoked.
	 * @param src                    The source block in the current context.
	 * @param dest                   The destination block in the current context.
	 */
	public AssistFlowFunction(SolverManager solverManager,
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
			throw new AssertionError("Unexpected instruction type at the call site.");
		}
		if (!src.isExitBlock()) {
			throw new AssertionError("Source block is not an exit block.");
		}

		this.invokeInstruction = (SSAInvokeInstruction) lastInstruction;

		this.paramMapping = new HashMap<>();
		int numParams = this.method.getNumberOfParameters();
		int numUses = lastInstruction.getNumberOfUses();

		for (int i = 0; i < numParams; ++i) {
			if (i < numUses) {
				this.paramMapping.put(i + 1, lastInstruction.getUse(i));
			}
		}
	}

	@Override
	public IntSet getTargets(int d1) {
		if (d1 == DEFAULT_PARAM) {
			return SparseFlowFunctionMap.ZERO_SET;
		}

		if (LOGGER.isDebugEnabled()) {
			LOGGER.debug("AssistFlowFunction flow , method : {} , call :{} , line : {}", call.getMethod(), call.getLastInstruction(), DFAUtils.getSourcePosition(call.getMethod(), call.getLastInstructionIndex()));
		}

		MutableSparseIntSet resultSet = MutableSparseIntSet.makeEmpty();
		DomainElement domainElement = (DomainElement) this.domain.getMappedObject(d1);
		AccessPath accessPath = domainElement.getAccessPath();

		if (accessPath.isStatic()) {
			resultSet.add(d1);
		} else if (domainElement.isReturnType()) {
			handleReturnType(domainElement, resultSet, accessPath);
		} else if (domainElement.isExceptionType()) {
			handleExceptionType(domainElement, resultSet, accessPath);
		} else if ((Selectors.isSpecialEdge(this.invokeInstruction.getDeclaredTarget().getSelector(), this.src.getMethod().getSelector())
			|| !this.paramMapping.containsKey(accessPath.getBase()) || !this.method.getParameterType(accessPath.getBase() - 1).isReferenceType())
			&& (accessPath.getBase() > 1 || !this.paramMapping.containsKey(accessPath.getBase()))) {
			Set<AccessPath> accessPaths = SparseTaintUtil.getParameterAccessPaths(this.src.getNode(), accessPath.getBase());
			for (AccessPath path : accessPaths) {
				if (Selectors.isSpecialEdge(this.invokeInstruction.getDeclaredTarget().getSelector(), this.src.getMethod().getSelector()) && path.getBase() == 1) {
					int i;
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
			handleNormalType(domainElement, resultSet, accessPath);
		}
		return resultSet;
	}

	private void handleReturnType(DomainElement domainElement, MutableSparseIntSet resultSet, AccessPath accessPath) {
		if (!this.killManager.needKillReturnValue(this.method.getSignature()) && this.invokeInstruction.getNumberOfReturnValues() > 0) {
			int returnValueIndex = this.invokeInstruction.getDef();
			AccessPath newPath = new AccessPath(returnValueIndex, accessPath.cloneFieldRefs(), this.dest.getNode());
			int newParam = this.domain.add(new DomainElement(this.call.getNode(), newPath, domainElement.getSource(), NORMAL, this.call.getDelegate().getInstruction(), domainElement));
			resultSet.add(newParam);
		}
	}

	private void handleExceptionType(DomainElement domainElement, MutableSparseIntSet resultSet, AccessPath accessPath) {
		if (this.dest.isExitBlock()) {
			AccessPath newPath = new AccessPath(accessPath.getBase(), accessPath.cloneFieldRefs(), this.dest.getNode());
			int newParam = this.domain.add(new DomainElement(this.call.getNode(), newPath, domainElement.getSource(), EXCEPTION, this.call.getDelegate().getInstruction(), domainElement));
			resultSet.add(newParam);
		} else if (this.dest.isCatchBlock()) {
			SSAGetCaughtExceptionInstruction catchExceptionInstruction = this.dest.getDelegate().getCatchInstruction();
			if (catchExceptionInstruction != null) {
				int exceptionIndex = catchExceptionInstruction.getException();
				AccessPath newPath = new AccessPath(exceptionIndex, accessPath.cloneFieldRefs(), this.dest.getNode());
				int newParam = this.domain.add(new DomainElement(this.call.getNode(), newPath, domainElement.getSource(), NORMAL, this.call.getDelegate().getInstruction(), domainElement));
				resultSet.add(newParam);
			}
		}
	}

	private void handleNormalType(DomainElement domainElement, MutableSparseIntSet resultSet, AccessPath accessPath) {
		Integer i = this.paramMapping.get(accessPath.getBase());
		if (Selectors.isSpecialEdge(this.invokeInstruction.getDeclaredTarget().getSelector(), this.src.getMethod().getSelector()) && accessPath.getBase() == 1) {
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

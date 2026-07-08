package com.repograph.taint.flow;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.api.IContext;
import com.repograph.taint.api.cache.GlobalCache;
import com.repograph.taint.sourcesink.KillManager;
import com.repograph.taint.sourcesink.KillParameterDefinition;
import com.repograph.taint.common.Selectors;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.flow.sparse.util.SparseTaintUtil;
import com.repograph.taint.flow.vistor.NormalFlowFunctionVisitor;
import com.repograph.taint.propagation.PropagationRuleManager;
import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.extutil.DFAUtils;
import com.ibm.wala.classLoader.IMethod;
import com.ibm.wala.core.util.strings.Atom;
import com.ibm.wala.dataflow.IFDS.IUnaryFlowFunction;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.Descriptor;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.Selector;
import com.ibm.wala.util.intset.IntIterator;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.IntSetAction;
import com.ibm.wala.util.intset.MutableSparseIntSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.repograph.taint.Engine.evaluateBeforeCoreInst;

public class CallFlowFunction implements IUnaryFlowFunction {

	private static final Logger LOGGER = LoggerFactory.getLogger(CallFlowFunction.class);

	// Map to store parameters and their corresponding indices
	private final Map<Integer, Set<Integer>> paramIndexMap;

	// Source and target basic blocks in context
	private final BasicBlockInContext<IExplodedBasicBlock> src;
	private final BasicBlockInContext<IExplodedBasicBlock> dest;

	// Managers for propagation rules, domain, and solver
	private final PropagationRuleManager ruleManager;
	private final TabulationDomain<IDomainElement, BasicBlockInContext<IExplodedBasicBlock>> domain;
	private final SolverManager solverManager;

	// Invoke instruction and kill manager
	private final SSAInvokeInstruction invokeInstruction;

	// TODO: update sterilize function
	private final KillManager killManager;

	private IContext context = GlobalCache.INSTANCE.get(GlobalCache.DEFAULT_KEY);

	public CallFlowFunction(
		SolverManager solverManager, PropagationRuleManager propagationRuleManager,
		BasicBlockInContext<IExplodedBasicBlock> src, BasicBlockInContext<IExplodedBasicBlock> dest) {
		this.solverManager = solverManager;
		this.killManager = solverManager.getKillManager();
		this.ruleManager = propagationRuleManager;
		this.domain = solverManager.getDomain();
		this.src = src;
		this.dest = dest;

		// Get the last instruction in the source block
		SSAInstruction lastInstruction = src.getLastInstruction();

		// Ensure the last instruction is an invoke instruction and target block is an entry block
		if (!(lastInstruction instanceof SSAInvokeInstruction)) {
			throw new AssertionError("Expected the last instruction to be an SSAInvokeInstruction.");
		}
		if (!dest.isEntryBlock()) {
			throw new AssertionError("Expected target block to be an entry block.");
		}

		this.invokeInstruction = (SSAInvokeInstruction) lastInstruction;

		// Map to store the parameters and their corresponding indices in the invocation
		this.paramIndexMap = new HashMap<>();
		int numUses = this.invokeInstruction.getNumberOfUses();
		for (int i = 0; i < numUses; ++i) {
			DFAUtils.putElementToMap(this.paramIndexMap, invokeInstruction.getUse(i), i + 1);
		}
	}

	/**
	 * Computes the target flow for a given domain element.
	 *
	 * @param d1 The index of the domain element
	 * @return The set of target domain elements
	 */
	@Override
	public IntSet getTargets(int d1) {
		MutableSparseIntSet targetSet = MutableSparseIntSet.makeEmpty();
		if (d1 == 0) {
			// Handle the case for the default flow (initial flow)
			handleDefaultFlow(targetSet);
		} else {
			// Handle the case for a specific flow (after method invocation)
			handleSpecificFlow(targetSet, d1);
		}
		return targetSet;
	}

	/**
	 * Handles the default flow scenario.
	 *
	 * @param targetSet The set of target domain elements to populate
	 */
	private void handleDefaultFlow(MutableSparseIntSet targetSet) {
		Atom mainMethodAtom = Atom.findOrCreateAsciiAtom("main");
		Selector mainSelector = new Selector(mainMethodAtom, Descriptor.findOrCreateUTF8("([Ljava/lang/String;)V"));

		// Special handling for the main method in static contexts
		if (this.dest.getMethod().getSelector().equals(mainSelector) && this.invokeInstruction.isStatic()) {
			int mappedIndex = SparseTaintUtil.createEntryParamElement(1, this.domain, this.dest);
			if (mappedIndex >= 0) {
				targetSet.add(mappedIndex);
			}
		}

		if (context.getCheckConfig().isUnbalancedOn()) {
			// Add default flow depending on configuration
			IntSet balancedFlow = SparseTaintUtil.createSourceParameterElements(this.domain, this.dest, this.dest);
			if (balancedFlow != null) {
				targetSet.addAll(balancedFlow);
			}
		} else {
			targetSet.add(0);
		}


		// Handle public methods in the SUMMARY pass
		if (context.getRule().getCurrentRuleName().equals("SUMMARY")) {
			handleSummaryPass(targetSet);
		} else {
			// Handle source/sink analysis and special cases for frameworks like Spring
			handleSpecialCases(targetSet);
		}
	}

	/**
	 * Handles the flow for specific domain elements after method invocation.
	 *
	 * @param targetSet The set of target domain elements to populate
	 * @param d1        The index of the domain element
	 */
	private void handleSpecificFlow(MutableSparseIntSet targetSet, int d1) {

		// Handle parameter killing based on configuration
		if (shouldKillParam(d1)) {
			return;
		}

		// Evaluate flow before core instruction
		NormalFlowFunctionVisitor evaluator = new NormalFlowFunctionVisitor(this.solverManager, d1, this.src, this.dest);
		MutableSparseIntSet intSet = evaluateBeforeCoreInst(this.src, d1, evaluator);

		MutableSparseIntSet newIntSet = MutableSparseIntSet.makeEmpty();

		// Handle custom rule processing
		if (this.ruleManager.canProcess(d1, this.src)) {
			processCustomRules(targetSet, intSet);
		} else {
			// Default processing for flows
			newIntSet.addAll(intSet);
			newIntSet.foreach(e -> {
				new IntSetAction() {
					@Override
					public void act(int x) {
						DomainElement domainElement = (DomainElement) domain.getMappedObject(x);
						AccessPath accessPath = domainElement.getAccessPath();
						if (accessPath.isStatic()) {
							targetSet.add(x);
						} else if (paramIndexMap.containsKey(accessPath.getBase())) {
							Set<Integer> integers = paramIndexMap.get(accessPath.getBase());
							for (Integer integer : integers) {
								if (Selectors.isSpecialEdge(invokeInstruction.getDeclaredTarget().getSelector(), src.getMethod().getSelector()) && integer == 2) {
									integer = 1;
								}
								int add = domain.add(new DomainElement(src.getNode(),
									new AccessPath(integer, accessPath.cloneFieldRefs(), src.getNode()),
									domainElement.getSource(), DomainElementType.NORMAL,
									src.getDelegate().getInstruction(), domainElement));
								targetSet.add(add);
							}
						} else {
							int numberOfUses = invokeInstruction.getNumberOfUses();
							for (int i = 0; i < numberOfUses; ++i) {
								Set<List<FieldReference>> resultSet = new HashSet<>();
								if (SparseTaintUtil.matchAccessPath(src.getNode(), invokeInstruction.getUse(i), accessPath, resultSet)) {
									for (List<FieldReference> fieldReferences : resultSet) {
										int index = i + 1;
										if (Selectors.isSpecialEdge(invokeInstruction.getDeclaredTarget().getSelector(), src.getMethod().getSelector()) && index == 2) {
											index = 1;
										}
										int add = domain.add(new DomainElement(src.getNode(),
											new AccessPath(index, fieldReferences, src.getNode()),
											domainElement.getSource(), DomainElementType.NORMAL,
											src.getDelegate().getInstruction(), domainElement));
										targetSet.add(add);
									}
								}
							}
						}
					}
				};
			});
		}
	}

	/**
	 * Handles the specific cases for frameworks like Spring or unreachable analysis.
	 *
	 * @param targetSet The set of target domain elements to populate
	 */
	private void handleSpecialCases(MutableSparseIntSet targetSet) {

		if (this.solverManager.getSources().contains(this.src)) {
			Set<Integer> sourceParaIdx = this.solverManager.getSourceSinkManager()
				.getSourceParaIdx(this.solverManager.getClassHierarchy(), this.dest.getMethod().getReference());
			if (sourceParaIdx != null) {
				sourceParaIdx.forEach((index) -> {
					if (index > 0) {
						int i = this.dest.getMethod().isStatic() ? index : index + 1;
						int domainElement = SparseTaintUtil.createEntryParamElement(i, this.domain, this.dest);
						if (domainElement >= 0) {
							targetSet.add(domainElement);
						}
					}
				});
			}
		}

		IntSet domainSet = SparseTaintUtil.createSourceParameterElements(this.domain, this.src, this.dest);
		if (domainSet != null) {
			targetSet.addAll(domainSet);
		}
	}

	/**
	 * Handles the public method processing in the SUMMARY pass.
	 *
	 * @param targetSet The set of target domain elements to populate
	 */
	private void handleSummaryPass(MutableSparseIntSet targetSet) {
		IMethod targetMethod = this.dest.getMethod();
		if (this.solverManager.getPublicMethods().contains(targetMethod)) {
			for (int i = 1; i <= targetMethod.getNumberOfParameters(); ++i) {
				int mappedIndex = SparseTaintUtil.createEntryParamElement(i, this.domain, this.dest);
				if (mappedIndex >= 0) {
					targetSet.add(mappedIndex);
				}
			}
		}
	}

	/**
	 * Processes custom propagation rules for a given flow.
	 *
	 * @param targetSet The set of target domain elements to populate
	 * @param intSet    The set of domain elements before core instruction
	 */
	private void processCustomRules(MutableSparseIntSet targetSet, MutableSparseIntSet intSet) {
		IntIterator iterator = intSet.intIterator();
		while (iterator.hasNext()) {
			int index = iterator.next();
			IntSet ruleSet = this.ruleManager.applyCallFlowFunction(index, this.src, this.dest);
			if (!ruleSet.isEmpty()) {
				targetSet.addAll(ruleSet);
			}
		}
	}

	/**
	 * Determines if a parameter should be killed based on configuration.
	 *
	 * @param domainElementIndex The index of the domain element
	 * @return True if the parameter should be killed, otherwise false
	 */
	private boolean shouldKillParam(int domainElementIndex) {
		if (this.killManager.getKilledParam().containsKey(this.invokeInstruction.getCallSite().getDeclaredTarget().getSignature())) {
			for (int i = 0; i < this.invokeInstruction.getNumberOfUses(); ++i) {
				if ((this.invokeInstruction.isStatic() || i != 0)
					&& ((DomainElement) this.domain.getMappedObject(domainElementIndex)).getAccessPath().getBase() == this.invokeInstruction.getUse(i)
					&& ((DomainElement) this.domain.getMappedObject(domainElementIndex)).getAccessPath().getBase() != -1) {

					int adjustedIndex = i;
					if (!this.invokeInstruction.isStatic()) {
						adjustedIndex = i - 1;
					}

					if (this.killManager.needKillParam(new KillParameterDefinition(this.invokeInstruction.getDeclaredTarget().getSignature(), adjustedIndex))) {
						return true;
					}
				}
			}
		}
		return false;
	}
}

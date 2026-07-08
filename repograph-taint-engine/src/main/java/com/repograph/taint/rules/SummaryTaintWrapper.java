package com.repograph.taint.rules;

import com.repograph.taint.sourcesink.IKillDefinition;
import com.repograph.taint.sourcesink.KillDefinition;
import com.repograph.taint.domain.AbstractDomainElement;
import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.domain.IDomainElement;
import com.repograph.taint.domain.element.DomainElement;
import com.repograph.taint.summary.AbstractSummaryTaintWrapper;
import com.repograph.taint.summary.data.FlowClear;
import com.repograph.taint.summary.data.FlowSink;
import com.repograph.taint.summary.data.FlowSource;
import com.repograph.taint.summary.data.MethodClear;
import com.repograph.taint.summary.data.MethodFlow;
import com.repograph.taint.summary.data.Taint;
import com.repograph.taint.taintWrappers.ITaintPropagationWrapper;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.callgraph.CallGraph;
import com.ibm.wala.ipa.callgraph.propagation.InstanceKey;
import com.ibm.wala.ipa.callgraph.propagation.PointerAnalysis;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.SSAInvokeInstruction;
import com.ibm.wala.ssa.SymbolTable;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.types.FieldReference;
import com.ibm.wala.types.MethodReference;
import com.ibm.wala.util.collections.MultiMap;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Set;

import static com.repograph.taint.api.DomainElementType.NORMAL;

public class SummaryTaintWrapper extends AbstractSummaryTaintWrapper
	implements ITaintPropagationWrapper<IDomainElement> {

	private final PointerAnalysis<InstanceKey> pa;

	private final String passNumber;

	private final HashMap<NodeAliasChecker, List<Object>> keyConstantHash = new HashMap<>();

	public SummaryTaintWrapper(String passNumber, String wrapperFile, CallGraph paramCallGraph,
							   PointerAnalysis<InstanceKey> paramPointerAnalysis) {
		super(wrapperFile, paramCallGraph);
		this.pa = paramPointerAnalysis;
		this.passNumber = passNumber;
	}

	public List<IDomainElement> getTaintsForMethod(
		BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext, IDomainElement paramIDomainElement) {
		DomainElement domainElement = (DomainElement) paramIDomainElement;
		AccessPath accessPath = domainElement.getAccessPath();
		if (accessPath.isStatic()) {
			return Collections.singletonList(domainElement);
		}

		SSAInstruction sSAInstruction = paramBasicBlockInContext.getDelegate().getInstruction();
		SSAInvokeInstruction sSAInvokeInstruction = (SSAInvokeInstruction) sSAInstruction;
		MethodReference methodReference = sSAInvokeInstruction.getDeclaredTarget();
		String str1 = methodReference.getSignature();
		String str2 = methodReference.getDeclaringClass().getName().toString();
		if (str2.equals("Ljava/lang/String") && str1.equals("java.lang.String.getChars(II[CI)V")) {
			return handleStringGetChars(paramBasicBlockInContext, domainElement);
		}
		List<IDomainElement> arrayList = new ArrayList<>();

		String str3 = methodReference.getName().toString();
		String str4 = methodReference.getDescriptor().toString();

		if ((str3.equals("equals") && str4.equals("(Ljava.lang.Object;)B"))
			|| (str3.equals("hashCode") && str4.equals("()I"))) {
			arrayList.add(domainElement);
			return arrayList;
		}
		Taint taint = createTaintFromAccessPathOnCall(paramBasicBlockInContext.getNode(), accessPath, sSAInvokeInstruction);
		if (taint == null) {
			arrayList.add(domainElement);
			return arrayList;
		}
		SymbolTable symbolTable = paramBasicBlockInContext.getNode().getIR().getSymbolTable();
		if (str2.equals("Ljava/util/HashMap") && !sSAInvokeInstruction.isStatic()
			&& (str1.equals("java.util.HashMap.put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;")
			|| str1.equals("java.util.HashMap.get(Ljava/lang/Object;)Ljava/lang/Object;"))) {
			int i = sSAInvokeInstruction.getUse(1);
			if (symbolTable.isStringConstant(i))
				return handleHashMapConstantKey(paramBasicBlockInContext, domainElement, symbolTable.getStringValue(i));
			DefUse defUse = paramBasicBlockInContext.getNode().getDU();
			SSAInstruction sSAInstruction1 = defUse.getDef(sSAInvokeInstruction.getUse(1));
			if (sSAInstruction1 instanceof SSAInvokeInstruction sSAInvokeInstruction1) {
				String str = sSAInvokeInstruction1.getDeclaredTarget().getSignature();
				if (str.equals("java.lang.Integer.valueOf(I)Ljava/lang/Integer;")) {
					if (symbolTable.isIntegerConstant(sSAInvokeInstruction1.getUse(0)))
						return handleHashMapConstantKey(paramBasicBlockInContext, domainElement,
							symbolTable.getConstantValue(sSAInvokeInstruction1.getUse(0)));
					if (symbolTable.isFloatConstant(sSAInvokeInstruction1.getUse(0)))
						return handleHashMapConstantKey(paramBasicBlockInContext, domainElement,
							symbolTable.getFloatValue(sSAInvokeInstruction1.getUse(0)));
					if (symbolTable.isDoubleConstant(sSAInvokeInstruction1.getUse(0)))
						return handleHashMapConstantKey(paramBasicBlockInContext, domainElement,
							symbolTable.getDoubleValue(sSAInvokeInstruction1.getUse(0)));
					if (symbolTable.isLongConstant(sSAInvokeInstruction1.getUse(0)))
						return handleHashMapConstantKey(paramBasicBlockInContext, domainElement,
							symbolTable.getLongValue(sSAInvokeInstruction1.getUse(0)));
				}
			}
		}
		MultiMap<String, MethodClear> multiMap1 = this.summaries.getClears();
		MultiMap<String, MethodFlow> multiMap2 = this.summaries.getFlows();

		if (multiMap1.containsKey(methodReference.getSignature()))
			for (MethodClear methodClear : multiMap1.get(methodReference.getSignature())) {
				if (flowMatchesTaint(methodClear.getClearDefinition(), taint))
					return Collections.emptyList();
			}
		if (multiMap2.containsKey(methodReference.getSignature()))
			for (MethodFlow methodFlow : multiMap2.get(methodReference.getSignature())) {
				FlowSource flowSource = methodFlow.source();
				if (flowMatchesTaint(flowSource, taint)) {
					int j;
					FlowSink flowSink = methodFlow.sink();
					List<FieldReference> list = flowSink.getFieldList();
					int i = flowSink.getParameterIndex();
					if (i == -1) {
						j = sSAInvokeInstruction.getDef();
					} else {
						j = sSAInvokeInstruction.getUse(i);
					}
					AccessPath accessPath1 = new AccessPath(j, list, paramBasicBlockInContext.getNode());
					DomainElement domainElement1 = new DomainElement(paramBasicBlockInContext.getNode(),
						accessPath1, domainElement.getSource(), NORMAL,
						paramBasicBlockInContext.getDelegate().getInstruction(),
						domainElement);
					if (!arrayList.contains(domainElement1))
						arrayList.add(domainElement1);
				}
			}
		if (!arrayList.contains(domainElement))
			arrayList.add(domainElement);
		return arrayList;
	}

	private List<IDomainElement> handleHashMapConstantKey(
		BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext,
		DomainElement paramDomainElement, Object paramObject) {
		SSAInstruction sSAInstruction = paramBasicBlockInContext.getDelegate().getInstruction();
		assert sSAInstruction instanceof SSAInvokeInstruction;
		SSAInvokeInstruction sSAInvokeInstruction = (SSAInvokeInstruction) sSAInstruction;
		MethodReference methodReference = sSAInvokeInstruction.getDeclaredTarget();
		String str = methodReference.getSignature();
		AccessPath accessPath = paramDomainElement.getAccessPath();
		List<IDomainElement> arrayList = new ArrayList<>();
		Taint taint = createTaintFromAccessPathOnCall(paramBasicBlockInContext.getNode(), accessPath, sSAInvokeInstruction);
		arrayList.add(paramDomainElement);
		MultiMap<String, MethodFlow> multiMap = this.summaries.getFlows();
		if (str.equals("java.util.HashMap.put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;")
			&& multiMap.containsKey(methodReference.getSignature()))
			for (MethodFlow methodFlow : multiMap.get(methodReference.getSignature())) {
				FlowSource flowSource = methodFlow.source();
				if (taint != null && flowMatchesTaint(flowSource, taint)) {
					int j;
					FlowSink flowSink = methodFlow.sink();
					List<FieldReference> list = flowSink.getFieldList();
					int i = flowSink.getParameterIndex();
					if (i == -1) {
						j = sSAInvokeInstruction.getDef();
					} else {
						j = sSAInvokeInstruction.getUse(i);
					}
					AccessPath accessPath1 = new AccessPath(j, list, paramBasicBlockInContext.getNode());
					DomainElement domainElement = new DomainElement(paramBasicBlockInContext.getNode(),
						accessPath1, paramDomainElement.getSource(), NORMAL,
						paramBasicBlockInContext.getDelegate().getInstruction(), paramDomainElement);
					if (!arrayList.contains(domainElement)) {
						arrayList.add(domainElement);
						NodeAliasChecker b = isContainsHashMapTaintKey(paramBasicBlockInContext.getNode(),
							sSAInvokeInstruction.getUse(0));
						if (b == null) {
							b = new NodeAliasChecker(this,
								paramBasicBlockInContext.getNode(), sSAInvokeInstruction.getUse(0));
							List<Object> arrayList1 = new ArrayList<>();
							arrayList1.add(paramObject);
							this.keyConstantHash.put(b, arrayList1);
							continue;
						}
						List<Object> list1 = this.keyConstantHash.get(b);
						if (!list1.contains(paramObject))
							list1.add(paramObject);
					}
				}
			}
		if (str.equals("java.util.HashMap.get(Ljava/lang/Object;)Ljava/lang/Object;")) {
			NodeAliasChecker b = isContainsHashMapTaintKey(paramBasicBlockInContext.getNode(),
				sSAInvokeInstruction.getUse(0));
			if (b != null) {
				List<Object> list = this.keyConstantHash.get(b);
				for (Object object : list) {
					if (object.equals(paramObject)) {
						int i = sSAInvokeInstruction.getDef();
						List<FieldReference> arrayList1 = new ArrayList<>();
						AccessPath accessPath1 = new AccessPath(i, arrayList1, paramBasicBlockInContext.getNode());
						DomainElement domainElement = new DomainElement(paramBasicBlockInContext.getNode(),
							accessPath1, paramDomainElement.getSource(), NORMAL,
							paramBasicBlockInContext.getDelegate().getInstruction(), paramDomainElement);
						if (!arrayList.contains(domainElement))
							arrayList.add(domainElement);
						break;
					}
				}
			}
		}
		return arrayList;
	}

	private NodeAliasChecker isContainsHashMapTaintKey(CGNode paramCGNode, int paramInt) {
		for (NodeAliasChecker b : this.keyConstantHash.keySet()) {
			if (b.nodeAliasChecker(paramCGNode, paramInt))
				return b;
		}
		return null;
	}

	private List<IDomainElement> handleStringGetChars(BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext, DomainElement paramDomainElement) {
		AccessPath accessPath = paramDomainElement.getAccessPath();
		List<IDomainElement> arrayList = new ArrayList<>();
		arrayList.add(paramDomainElement);
		if (paramBasicBlockInContext.getDelegate().getInstruction().getUse(0) == accessPath.getBase()) {
			AccessPath accessPath1 = new AccessPath(paramBasicBlockInContext.getDelegate().getInstruction().getUse(3), null, paramBasicBlockInContext.getNode());
			arrayList.add(new DomainElement(paramBasicBlockInContext.getNode(), accessPath1, paramDomainElement.getSource(), NORMAL, paramBasicBlockInContext.getDelegate().getInstruction(), (AbstractDomainElement) paramDomainElement));
		}
		return arrayList;
	}

	public boolean isExclusive(BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext) {
		SSAInstruction sSAInstruction = paramBasicBlockInContext.getDelegate().getInstruction();
		return isExclusive(sSAInstruction);
	}

	public boolean isExclusive(SSAInstruction paramSSAInstruction) {
		assert paramSSAInstruction instanceof SSAInvokeInstruction;
		MethodReference methodReference = ((SSAInvokeInstruction) paramSSAInstruction).getDeclaredTarget();
		String str1 = methodReference.getSignature();
		String str2 = methodReference.getDeclaringClass().getName().toString();
		return str2.equals("Ljava/lang/String") && str1.equals("java.lang.String.getChars(II[CI)V")
			|| this.summaries.containsKey(methodReference);
	}

	@Override
	public boolean isKill(BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext,
						  IDomainElement paramIDomainElement) {
		SSAInstruction sSAInstruction = paramBasicBlockInContext.getDelegate().getInstruction();
		assert sSAInstruction instanceof SSAInvokeInstruction;
		SSAInvokeInstruction sSAInvokeInstruction = (SSAInvokeInstruction) sSAInstruction;
		MethodReference methodReference = sSAInvokeInstruction.getDeclaredTarget();
		DomainElement domainElement = (DomainElement) paramIDomainElement;
		AccessPath accessPath = domainElement.getAccessPath();
		Taint taint = createTaintFromAccessPathOnCall(paramBasicBlockInContext.getNode(), accessPath, sSAInvokeInstruction);
		MultiMap<String, MethodClear> multiMap = this.summaries.getClears();
		if (multiMap.containsKey(methodReference.getSignature()))
			for (MethodClear methodClear : multiMap.get(methodReference.getSignature())) {
				if (flowMatchesTaint(methodClear.getClearDefinition(), taint))
					return true;
			}
		return false;
	}

	public void addKillSet(Set<IKillDefinition> paramSet) {
		for (IKillDefinition iKillDefinition : paramSet) {
			if (iKillDefinition instanceof KillDefinition killDefinition) {
				if (this.passNumber != null && !killDefinition.getBelongTo().contains(this.passNumber))
					continue;
				MethodReference methodReference = killDefinition.getMethodReference();
				MethodClear methodClear = new MethodClear(methodReference,
					new FlowClear(killDefinition.getParameterIndex(), killDefinition.getFields()));
				this.summaries.addClear(methodClear);
			}
		}
	}

	private Taint createTaintFromAccessPathOnCall(CGNode paramCGNode, AccessPath paramAccessPath,
												  SSAInvokeInstruction paramSSAInvokeInstruction) {
		Taint taint = null;
		int i = getParameterIndex(paramCGNode, paramSSAInvokeInstruction, paramAccessPath);
		if (i >= 0) {
			List<FieldReference> fieldRefs = paramAccessPath.getFieldRefs();
			taint = new Taint(i, fieldRefs);
		}
		return taint;
	}

	private int getParameterIndex(CGNode paramCGNode, SSAInvokeInstruction paramSSAInvokeInstruction,
								  AccessPath paramAccessPath) {
		if (paramAccessPath.isStatic()) {
			return Integer.MIN_VALUE;
		}
		for (byte b = 0; b < paramSSAInvokeInstruction.getNumberOfUses(); b++) {
			if (paramSSAInvokeInstruction.getUse(b) == paramAccessPath.getBase()) {
				return b;
			}
		}
		return Integer.MIN_VALUE;
	}

	public PointerAnalysis<InstanceKey> getPa() {
		return pa;
	}
}

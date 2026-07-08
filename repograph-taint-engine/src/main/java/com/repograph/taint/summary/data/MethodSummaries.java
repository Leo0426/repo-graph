package com.repograph.taint.summary.data;

import com.ibm.wala.types.MethodReference;
import com.ibm.wala.util.collections.ArraySetMultiMap;
import com.ibm.wala.util.collections.MultiMap;

import java.util.Set;

public class MethodSummaries {
	private volatile MultiMap<String, MethodFlow> flows;
	private volatile MultiMap<String, MethodClear> clears;

	public MethodSummaries() {
		this(ArraySetMultiMap.make());
	}

	MethodSummaries(Set<MethodFlow> flows) {
		this(flowSetToFlowMap(flows), null);
	}

	MethodSummaries(MultiMap<String, MethodFlow> flows) {
		this(flows, null);
	}

	MethodSummaries(MultiMap<String, MethodFlow> flows, MultiMap<String, MethodClear> clears) {
		this.flows = flows;
		this.clears = clears;
	}

	private static MultiMap<String, MethodFlow> flowSetToFlowMap(Set<MethodFlow> flows) {
		MultiMap<String, MethodFlow> flowSet = ArraySetMultiMap.make();
		if (flows != null && !flows.isEmpty()) {
			for (MethodFlow flow : flows)
				flowSet.put(flow.getMR().getSignature(), flow);
		}
		return flowSet;
	}

	// CHECKSTYLE:OFF
	public boolean containsKey(MethodReference mr) {
		if (flows == null || clears == null)
			return false;
		if (flows.containsKey(mr.getSignature()))
			return true;
		if (clears.containsKey(mr.getSignature()))
			return true;
		return false;
	}

	public boolean addFlow(MethodFlow flow) {
		ensureFlows();
		return flows.put(flow.mr.getSignature(), flow);
	}

	public boolean addClear(MethodClear clear) {
		ensureClears();
		return clears.put(clear.mr.getSignature(), clear);
	}

	public MultiMap<String, MethodFlow> getFlows() {
		return this.flows;
	}

	public MultiMap<String, MethodClear> getClears() {
		return this.clears;
	}

	private void ensureFlows() {
		if (flows == null) {
			synchronized (this) {
				if (flows == null)
					flows = ArraySetMultiMap.make();
			}
		}
	}

	private void ensureClears() {
		if (clears == null) {
			synchronized (this) {
				if (clears == null)
					clears = ArraySetMultiMap.make();
			}
		}
	}
}

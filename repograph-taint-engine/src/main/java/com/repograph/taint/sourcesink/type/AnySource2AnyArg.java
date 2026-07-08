package com.repograph.taint.sourcesink.type;

import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.ibm.wala.util.collections.Pair;

import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

public class AnySource2AnyArg implements TaintedType {
	public JSONObject toJSONObject() {
		return new JSONObject();
	}

	@Override
	public <D> Set<D> collectValidElements(Map<Integer, Set<Pair<D, SourceDefinition>>> idx2des) {
		return idx2des.values().stream().flatMap(Collection::stream).map(pair -> pair.fst)
			.collect(Collectors.toSet());
	}
}

package com.repograph.taint.sourcesink.type;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.ibm.wala.util.collections.Pair;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

public class SpecialSource2AnyArg implements TaintedType {
	private final List<SourceDefinition> sources;

	public SpecialSource2AnyArg(List<SourceDefinition> sources) {
		this.sources = new ArrayList<>(sources);
	}

	@Override
	public JSONObject toJSONObject() {
		return new JSONObject().fluentPut("SpecialSource2AnyArg", new JSONArray(sources));
	}

	@Override
	public <D> Set<D> collectValidElements(Map<Integer, Set<Pair<D, SourceDefinition>>> idx2des) {
		return idx2des.values().stream()
			.flatMap(Set::stream)
			.filter(pair -> sources.contains(pair.snd))
			.map(pair -> pair.fst)
			.collect(Collectors.toSet());
	}
}

package com.repograph.taint.sourcesink.type;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.ibm.wala.util.collections.Pair;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

public class SpecialSource2SpecialArg implements TaintedType {
	private Map<Integer, Set<SourceDefinition>> sources;

	public SpecialSource2SpecialArg(Map<Integer, Set<SourceDefinition>> sources) {
		if (sources == null)
			this.sources = new HashMap<>();
		else
			this.sources = sources;
	}

	public JSONObject toJSONObject() {
		JSONObject jsonObject = new JSONObject();
		JSONArray jsonArray = new JSONArray();
		sources.forEach((Key, value) -> {
			JSONObject arg = new JSONObject();
			arg.put("Index", Key);
			JSONArray sources = new JSONArray();
			sources.addAll(value);
			arg.put("Sources", sources);
			jsonArray.add(arg);
		});
		jsonObject.put("SpecialSource2AnyArg", jsonArray);
		return jsonObject;
	}

	@Override
	public <D> Set<D> collectValidElements(Map<Integer, Set<Pair<D, SourceDefinition>>> idx2des) {
		return idx2des.entrySet().stream().filter(entry -> sources.containsKey(entry.getKey())).flatMap(
				entry -> entry.getValue().stream().filter(pair -> sources.get(entry.getKey()).contains(pair.snd)))
			.map(pair -> pair.fst).collect(Collectors.toSet());
	}
}

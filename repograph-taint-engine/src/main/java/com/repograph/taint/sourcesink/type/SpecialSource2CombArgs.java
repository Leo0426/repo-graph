package com.repograph.taint.sourcesink.type;


import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.ibm.wala.util.collections.Pair;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

public class SpecialSource2CombArgs implements TaintedType {
	private Map<Integer, Set<SourceDefinition>> sources;

	public SpecialSource2CombArgs(Map<Integer, Set<SourceDefinition>> sources) {
		if (sources == null)
			this.sources = new HashMap<>();
		else
			this.sources = sources;
	}

	public JSONObject toJSONObject() {
		JSONObject jsonObject = new JSONObject();
		JSONArray jsonArray = new JSONArray();
		sources.forEach((key, value) -> {
			JSONObject arg = new JSONObject();
			arg.put("Index", key);
			JSONArray sources = new JSONArray();
			sources.addAll(value);
			arg.put("Sources", sources);
			jsonArray.add(arg);
		});
		jsonObject.put("SpecialSource2CombArgs", jsonArray);
		return jsonObject;
	}

	@Override
	public <D> Set<D> collectValidElements(Map<Integer, Set<Pair<D, SourceDefinition>>> idx2des) {
		Set<D> ret = new HashSet<>();
		if (idx2des.keySet().containsAll(sources.keySet())) {
			for (Map.Entry<Integer, Set<Pair<D, SourceDefinition>>> entry : idx2des.entrySet()) {
				if (!sources.containsKey(entry.getKey())) {
					continue;
				}
				Set<D> s = entry.getValue().stream().filter(pair -> sources.get(entry.getKey()).contains(pair.snd))
					.map(pair -> pair.fst).collect(Collectors.toSet());
				if (s.isEmpty()) {
					return Collections.emptySet();
				} else {
					ret.addAll(s);
				}
			}
			return ret;
		}
		return Collections.emptySet();
	}
}

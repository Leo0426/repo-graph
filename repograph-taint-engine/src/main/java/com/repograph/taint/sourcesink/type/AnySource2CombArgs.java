package com.repograph.taint.sourcesink.type;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.ibm.wala.util.collections.Pair;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

public class AnySource2CombArgs implements TaintedType {
	private List<Integer> indexs = new ArrayList<>();

	public AnySource2CombArgs(List<Integer> indexs) {
		this.indexs.addAll(indexs);
	}

	public JSONObject toJSONObject() {
		JSONObject jsonObject = new JSONObject();
		JSONArray jsonArray = new JSONArray();
		indexs.forEach(index -> {
			JSONObject indexJson = new JSONObject();
			indexJson.put("Index", index);
			jsonArray.add(indexJson);
		});
		jsonObject.put("AnySource2CombArgs", jsonArray);
		return jsonObject;
	}

	@Override
	public <D> Set<D> collectValidElements(Map<Integer, Set<Pair<D, SourceDefinition>>> idx2des) {
		if (idx2des.keySet().containsAll(indexs)) {
			return idx2des.entrySet().stream().filter(entry -> indexs.contains(entry.getKey()))
				.flatMap(entry -> entry.getValue().stream()).map(pair -> pair.fst).collect(Collectors.toSet());
		}
		return Collections.emptySet();
	}
}



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

public class AnySource2SpecialArg implements TaintedType {
	private List<Integer> indexs = new ArrayList<>();

	public AnySource2SpecialArg(List<Integer> indexs) {
		this.indexs.addAll(indexs);
	}

	public JSONObject toJSONObject() {
		JSONObject jsonObject = new JSONObject();
		JSONArray jsonArray = new JSONArray();
		jsonArray.addAll(indexs);
		jsonObject.put("AnySource2SpecialArg", jsonArray);
		return jsonObject;
	}

	@Override
	public <D> Set<D> collectValidElements(Map<Integer, Set<Pair<D, SourceDefinition>>> idx2des) {
		return idx2des.entrySet().stream().filter(entry -> indexs.contains(entry.getKey()))
			.flatMap(entry -> entry.getValue().stream()).map(pair -> pair.fst).collect(Collectors.toSet());
	}
}

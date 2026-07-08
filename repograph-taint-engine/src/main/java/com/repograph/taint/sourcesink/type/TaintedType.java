package com.repograph.taint.sourcesink.type;

import com.alibaba.fastjson2.JSONObject;
import com.repograph.taint.sourcesink.SourceDefinition;
import com.ibm.wala.util.collections.Pair;

import java.util.Map;
import java.util.Set;

public interface TaintedType {
	JSONObject toJSONObject();

	<D> Set<D> collectValidElements(Map<Integer, Set<Pair<D, SourceDefinition>>> idx2des);
}

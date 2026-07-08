

package com.repograph.taint.summary.data;

import com.ibm.wala.types.FieldReference;

import java.util.List;

public class FlowSink extends AbstractFlowSinkSource {

	public FlowSink(int parameterIdx, List<FieldReference> fieldList) {
		super(parameterIdx, fieldList);
	}

	@Override
	public String toString() {
		return "Parameter " + parameterIdx + (fieldList == null ? "" : " " + fieldList.toString());
	}
}

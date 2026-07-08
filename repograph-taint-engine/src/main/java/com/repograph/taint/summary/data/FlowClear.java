

package com.repograph.taint.summary.data;

import com.ibm.wala.types.FieldReference;

import java.util.List;

public class FlowClear extends AbstractFlowSinkSource {

	public FlowClear(int parameterIdx, List<FieldReference> fieldList) {
		super(parameterIdx, fieldList);
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + fieldList.hashCode();
		result = prime * result + parameterIdx;
		return result;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		AbstractFlowSinkSource other = (AbstractFlowSinkSource) obj;
		if (!fieldList.equals(other.fieldList))
			return false;
		if (parameterIdx != other.parameterIdx)
			return false;
		return true;
	}
}

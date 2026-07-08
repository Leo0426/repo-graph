package com.repograph.taint.summary.data;

import com.ibm.wala.types.FieldReference;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

public class AbstractFlowSinkSource {

	protected final int parameterIdx;

	protected final List<FieldReference> fieldList;

	public AbstractFlowSinkSource(int parameterIdx, List<FieldReference> fieldList) {
		this.parameterIdx = parameterIdx;
		this.fieldList = Objects.requireNonNullElseGet(fieldList, ArrayList::new);
	}

	public int getParameterIndex() {
		return parameterIdx;
	}

	public List<FieldReference> getFieldList() {
		return fieldList;
	}

	public FieldReference getFirstFieldList() {
		if (fieldList.isEmpty()) {
			return null;
		}
		return fieldList.get(0);
	}

	public int getFieldLength() {
		return fieldList.size();
	}
}

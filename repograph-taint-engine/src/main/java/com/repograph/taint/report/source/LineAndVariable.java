/*
 * Copyright (C) 2022 wuKong, tianQi company. - All Rights Reserved
 */

package com.repograph.taint.report.source;

import com.google.common.base.MoreObjects;

/**
 * line and variables
 *
 * @author leolu
 * @since 7/28/22
 */
public class LineAndVariable {

	private int lineNumber;

	private String useVariableNames;

	private String defVariableNames;

	public static Builder builder() {
		return new Builder();
	}

	public int getLineNumber() {
		return lineNumber;
	}

	public void setLineNumber(int lineNumber) {
		this.lineNumber = lineNumber;
	}

	public String getUseVariableNames() {
		return useVariableNames;
	}

	public void setUseVariableNames(String useVariableNames) {
		this.useVariableNames = useVariableNames;
	}

	public String getDefVariableNames() {
		return defVariableNames;
	}

	public void setDefVariableNames(String defVariableNames) {
		this.defVariableNames = defVariableNames;
	}

	public static final class Builder {
		private int lineNumber;
		private String useVariableNames;
		private String defVariableNames;

		private Builder() {
		}

		public Builder withLineNumber(int lineNumber) {
			this.lineNumber = lineNumber;
			return this;
		}

		public Builder withUseVariableNames(String useVariableNames) {
			this.useVariableNames = useVariableNames;
			return this;
		}

		public Builder withDefVariableNames(String defVariableNames) {
			this.defVariableNames = defVariableNames;
			return this;
		}

		public LineAndVariable build() {
			LineAndVariable lineAndVariable = new LineAndVariable();
			lineAndVariable.setLineNumber(lineNumber);
			lineAndVariable.setUseVariableNames(useVariableNames);
			lineAndVariable.setDefVariableNames(defVariableNames);
			return lineAndVariable;
		}
	}

	@Override
	public String toString() {
		return MoreObjects.toStringHelper(this)
			.add("lineNumber", lineNumber)
			.add("useVariableNames", useVariableNames)
			.add("defVariableNames", defVariableNames)
			.toString();
	}
}



package com.repograph.taint.sourcesink;

public class KillFieldDefinition {
	private String declaringClass;
	private String fieldName;
	private String fieldType;

	public KillFieldDefinition(String declaringClass, String fieldName, String fieldType) {
		this.declaringClass = declaringClass;
		this.fieldName = fieldName;
		this.fieldType = fieldType;
	}

	public String toString() {
		return declaringClass + ", " + fieldType + ": " + fieldName;
	}

	public String getDeclaringClass() {
		return declaringClass;
	}

	public String getFieldName() {
		return fieldName;
	}

	public String getFieldType() {
		return fieldType;
	}

}

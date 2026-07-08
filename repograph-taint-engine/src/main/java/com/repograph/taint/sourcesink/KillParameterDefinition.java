package com.repograph.taint.sourcesink;

public class KillParameterDefinition {

	private String methodName;
	private int position;

	public KillParameterDefinition(String method, int pos) {
		this.methodName = method;
		this.position = pos;
	}

	public String toString() {
		return methodName + ":" + position;
	}

	public String getMethodName() {
		return methodName;
	}

	public int getPosition() {
		return position;
	}

}

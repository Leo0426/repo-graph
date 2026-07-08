package com.repograph.taint.support.framework.spring.annotations;

import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;

public class RequestBody implements IAnnotation {
	private boolean required;

	public RequestBody(ElementValue required) {
		// TODO map para to required
	}

	public boolean required() {
		return required;
	}
}

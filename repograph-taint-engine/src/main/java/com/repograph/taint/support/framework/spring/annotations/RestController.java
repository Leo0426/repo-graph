package com.repograph.taint.support.framework.spring.annotations;

import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;

public class RestController implements IAnnotation {
	String value;

	public RestController(ElementValue value) {
		// TODO map para to value
	}
}

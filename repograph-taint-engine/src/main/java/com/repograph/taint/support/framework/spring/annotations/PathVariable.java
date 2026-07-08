package com.repograph.taint.support.framework.spring.annotations;

import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;

public class PathVariable implements IAnnotation {
	String value;

	public PathVariable(ElementValue value) {
		// TODO map para to value
	}
}

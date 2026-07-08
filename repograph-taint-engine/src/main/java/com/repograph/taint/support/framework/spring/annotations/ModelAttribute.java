package com.repograph.taint.support.framework.spring.annotations;


import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;

public class ModelAttribute implements IAnnotation {
	String value;

	public ModelAttribute(ElementValue value) {
		// TODO map para to value
	}
}

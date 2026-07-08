package com.repograph.taint.support.framework.spring.annotations;


import com.ibm.wala.shrike.shrikeCT.AnnotationsReader;

public class Component implements IAnnotation {
	String value;

	public Component(AnnotationsReader.ElementValue value) {
		// TODO map para to value
	}
}

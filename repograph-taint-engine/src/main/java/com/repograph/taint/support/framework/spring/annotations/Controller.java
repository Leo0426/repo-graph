package com.repograph.taint.support.framework.spring.annotations;


import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;

public class Controller implements IAnnotation {
	String value;

	public Controller(ElementValue value) {
		// TODO map para to value
	}
}

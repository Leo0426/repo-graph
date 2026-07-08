

package com.repograph.taint.support.framework.spring.annotations;

import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;

public class Repository implements IAnnotation {
	String value;

	public Repository(ElementValue value) {
		// TODO map para to value
	}
}

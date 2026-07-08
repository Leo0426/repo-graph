package com.repograph.taint.support.framework.spring.annotations;

import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;

public class CookieValue implements IAnnotation {
	String value;
	String name;
	boolean required;
	String defaultValue;

	public CookieValue(ElementValue value, ElementValue name, ElementValue required, ElementValue defaultValue) {
		// TODO map para to field
	}

	/**
	 * name and value are aliases
	 */
	public String value() {
		return value;
	}

	/**
	 * name and value are aliases
	 */
	public String name() {
		return name;
	}

	/**
	 * Whether the header is required.
	 * <p>
	 * Defaults to {@code true}, leading to an exception being thrown if the header
	 * is missing in the request. Switch this to {@code false} if you prefer a
	 * {@code null} value if the header is not present in the request.
	 * <p>
	 * Alternatively, provide a {@link #defaultValue}, which implicitly sets this
	 * flag to {@code false}.
	 */
	public boolean required() {
		return required;
	}

	/**
	 * The default value to use as a fallback.
	 * <p>
	 * Supplying a default value implicitly sets {@link #required} to {@code false}.
	 */
	public String defaultValue() {
		return defaultValue;
	}
}

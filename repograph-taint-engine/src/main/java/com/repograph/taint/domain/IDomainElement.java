package com.repograph.taint.domain;

import com.repograph.taint.api.DomainElementType;
import com.repograph.taint.domain.AbstractDomainElement.Info;

import java.util.List;


/**
 * Represents a domain element in the context of taint analysis.
 * <p>
 * This interface defines the contract for domain elements, which are used
 * to model program behaviors and identify sensitive data flows within
 * an application's logic. Each implementation provides detailed information
 * about program context, value mappings, and the type of data elements.
 * </p>
 * <p>
 * Implementations may include return types, exception types, and provide
 * methods for accessing program source information and related metadata (e.g., `Info` objects).
 * </p>
 */
public interface IDomainElement {

	DomainElementType getElementType();

	boolean isReturnType();

	boolean isExceptionType();

	SourceContext getSource();

	List<Info> getInfos();

	String getValueName(int index, Info info);
}

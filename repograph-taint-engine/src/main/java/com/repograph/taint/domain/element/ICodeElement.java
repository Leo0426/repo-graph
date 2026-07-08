package com.repograph.taint.domain.element;

import com.ibm.wala.ipa.callgraph.CGNode;

/**
 * Interface representing a code element within the context of a call graph analysis.
 * <p>
 * Implementations of this interface are used to model specific components
 * of a program's control flow and data flow within taint analysis.
 * </p>
 * <p>
 * Provides methods for retrieving the associated call graph node and
 * supporting equality and hash code operations for accurate mapping and comparison.
 * </p>
 */
public interface ICodeElement {

	/**
	 * Checks whether this instance is equal to another object.
	 * <p>
	 * Two instances are considered equal if their content and call graph node mappings
	 * align, based on the implementation of the concrete class.
	 * </p>
	 *
	 * @param obj the object to be compared
	 * @return {@code true} if this instance is equal to the specified object, otherwise {@code false}
	 */
	@Override
	boolean equals(Object obj);

	/**
	 * Computes the hash code for this instance.
	 * <p>
	 * This method ensures consistent hashing based on the content and structure
	 * of the implementation, allowing instances of this type to be used in hash-based
	 * collections, such as {@code HashMap} or {@code HashSet}.
	 * </p>
	 *
	 * @return the hash code of this instance
	 */
	@Override
	int hashCode();

	/**
	 * Retrieves the associated call graph node ({@code CGNode}) for this code element.
	 * <p>
	 * This node represents the method or logical unit in the call graph to which
	 * this code element belongs, providing insights into the program’s control flow.
	 * </p>
	 *
	 * @return the call graph node associated with this code element
	 */
	CGNode getCGNode();
}

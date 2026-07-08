package com.repograph.taint.domain.element;

import com.ibm.wala.ipa.callgraph.CGNode;

import java.util.Objects;


/**
 * Represents a local variable element in the program that is tracked for taint analysis.
 * <p>
 * This abstract class uniquely identifies a local variable using a value number
 * and the call graph node (CGNode) in which it resides. Subclasses of this class
 * are expected to provide additional functionality specific to their domain.
 * </p>
 */
public abstract class AbsLocalElement implements ICodeElement {
	private final int valueNumber;
	private final CGNode node;

	/**
	 * Constructs an instance of `ILocalElement` using a value number
	 * and a call graph node (CGNode) to uniquely identify the local element.
	 *
	 * @param id   the value number of the local variable
	 * @param node the call graph node in which the variable resides
	 */
	public AbsLocalElement(int id, CGNode node) {
		this.valueNumber = id;
		this.node = node;
	}

	/**
	 * Retrieves the value number that identifies this local element.
	 *
	 * @return the value number of the local variable
	 */
	public int getValueNumber() {
		return valueNumber;
	}

	/**
	 * Retrieves the call graph node (CGNode) associated with this local element.
	 *
	 * @return the call graph node in which the local variable resides
	 */
	public CGNode getCGNode() {
		return node;
	}

	/**
	 * Checks whether this `ILocalElement` is equal to another object.
	 * <p>
	 * Two `ILocalElement` objects are considered equal if their value numbers
	 * are identical and they belong to the same call graph node (CGNode).
	 * </p>
	 *
	 * @param o the object to compare with
	 * @return true if the objects are equal, false otherwise
	 */
	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		AbsLocalElement that = (AbsLocalElement) o;
		return getValueNumber() == that.getValueNumber() && Objects.equals(node, that.node);
	}

	/**
	 * Computes the hash code for this `ILocalElement`.
	 * <p>
	 * The hash code is calculated using the value number of the local element
	 * and the call graph node (CGNode) it belongs to.
	 * </p>
	 *
	 * @return the hash code of this object
	 */
	@Override
	public int hashCode() {
		return Objects.hash(getValueNumber(), node);
	}
}

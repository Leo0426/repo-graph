package com.repograph.taint.domain.element;

import com.ibm.wala.ipa.callgraph.CGNode;

import java.util.Objects;


/**
 * Represents a return element in the context of taint analysis.
 * <p>
 * This class stores information about a specific return value associated with a method call in the call graph.
 * It provides methods to access the return value, its associated CGNode, and other related metadata.
 * </p>
 */
public class ReturnElement implements ICodeElement {
	/**
	 * A constant artificial value number, used for differentiation.
	 */
	private final int vn = -2;

	/**
	 * The result value associated with the return element.
	 */
	private final int result;

	/**
	 * The CGNode representing the method in which this return value occurs.
	 */
	private final CGNode node;

	/**
	 * Constructs a new `ReturnElement` object.
	 *
	 * @param result the result value associated with the return
	 * @param node   the call graph node representing the method in which this return occurs
	 */
	public ReturnElement(int result, CGNode node) {
		this.result = result;
		this.node = node;
	}

	/**
	 * Returns the constant value number for this return element.
	 *
	 * @return the value number
	 */
	public int getValueNumber() {
		return this.vn;
	}

	/**
	 * Returns the call graph node associated with this return element.
	 *
	 * @return the CGNode object
	 */
	public CGNode getCGNode() {
		return this.node;
	}

	/**
	 * Returns the result value of this return element.
	 *
	 * @return the result value
	 */
	public int getResult() {
		return this.result;
	}

	/**
	 * Returns a string representation of this `ReturnElement`.
	 *
	 * @return a string in the format `RE<result>`
	 */
	public String toString() {
		return "RE<" + this.result + ">";
	}

	/**
	 * Compares this `ReturnElement` with another object for equality.
	 * Two `ReturnElement` instances are equal if they have the same `vn`, `result`, and `node` values.
	 *
	 * @param o the object to compare against
	 * @return true if the objects are equal, false otherwise
	 */
	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		ReturnElement that = (ReturnElement) o;
		return getResult() == that.getResult() && Objects.equals(node, that.node);
	}

	/**
	 * Returns a hash code for this `ReturnElement`, based on its attributes.
	 *
	 * @return the hash code
	 */
	@Override
	public int hashCode() {
		return Objects.hash(vn, getResult(), node);
	}
}

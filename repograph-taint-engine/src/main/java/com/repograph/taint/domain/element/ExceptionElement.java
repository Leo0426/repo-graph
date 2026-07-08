package com.repograph.taint.domain.element;

import com.ibm.wala.ipa.callgraph.CGNode;

import java.util.Objects;


/**
 * Represents an exception-specific element in the context of the code analysis.
 * <p>
 * This class provides details about the relationship between a CGNode and its fixed
 * value number (-3), supporting equality checks and hash caching for performance.
 * </p>
 */
public class ExceptionElement implements ICodeElement {
	private static final int VN = -3;
	private final CGNode node;
	private int hashCode;

	public ExceptionElement(CGNode node) {
		this.node = Objects.requireNonNull(node, "node must not be null");
	}

	public CGNode getCGNode() {
		return this.node;
	}

	public int getValueNumber() {
		return VN;
	}

	@Override
	public String toString() {
		return "ExceptionElement [node=" + this.node + "]";
	}

	/**
	 * Compares the given object with this `ExceptionElement` for equality.
	 * <p>
	 * Two `ExceptionElement` instances are considered equal if they belong to
	 * the same class and are associated with the same `CGNode`.
	 * </p>
	 *
	 * @param o the object to compare with this instance
	 * @return true if the given object is equal to this instance; false otherwise
	 */
	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		ExceptionElement that = (ExceptionElement) o;
		return Objects.equals(node, that.node);
	}

	/**
	 * Calculates and caches the hash code for this `ExceptionElement`.
	 * <p>
	 * The hash code is based on the associated `CGNode` and its fixed value number (-3).
	 * If the hash code has already been calculated, the cached value is returned,
	 * significantly improving performance during frequent hash-based operations.
	 * </p>
	 *
	 * @return the cached or newly computed hash code for this instance
	 */
	@Override
	public int hashCode() {
		// 缓存HashCode以提高性能
		if (hashCode == 0) {
			hashCode = Objects.hash(node, VN);
		}
		return hashCode;
	}
}

package com.repograph.taint.domain.element;

import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.types.FieldReference;

import java.util.Objects;


/**
 * Represents a return field element in the taint analysis engine.
 * <p>
 * This class models a field reference that is returned by a method,
 * providing functionality for equality checks, hashing, and string representation.
 * </p>
 */
public class ReturnFieldElement extends AbsLocalElement {
	private final FieldReference fieldRef;

	/**
	 * Constructs a new instance of ReturnFieldElement.
	 *
	 * @param node the call graph node (CGNode) associated with this field reference
	 * @param ref  the field reference being returned by the method
	 */
	public ReturnFieldElement(CGNode node, FieldReference ref) {
		super(-2, node);
		this.fieldRef = ref;
	}

	/**
	 * Retrieves the field reference associated with this element.
	 *
	 * @return the field reference of the return element
	 */
	public FieldReference getFieldRef() {
		return this.fieldRef;
	}

	/**
	 * Checks if this object is equal to another object.
	 * <p>
	 * Two ReturnFieldElement objects are considered equal if their superclass's equality checks pass
	 * and their associated field references are equal.
	 * </p>
	 *
	 * @param o the object to compare with
	 * @return true if the objects are equal, false otherwise
	 */
	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		if (!super.equals(o)) return false;
		ReturnFieldElement that = (ReturnFieldElement) o;
		return Objects.equals(getFieldRef(), that.getFieldRef());
	}

	/**
	 * Generates a hash code for this object.
	 * <p>
	 * The hash code is derived from the superclass's hash code and the hash of its field reference.
	 * </p>
	 *
	 * @return the hash code of this object
	 */
	@Override
	public int hashCode() {
		return Objects.hash(super.hashCode(), getFieldRef());
	}

	/**
	 * Returns a string representation of this object.
	 * <p>
	 * The string format is "RFE&lt;fieldName&gt;", where "fieldName"
	 * is the name of the field reference.
	 * </p>
	 *
	 * @return the string representation of this object
	 */
	public String toString() {
		return "RFE<" + this.fieldRef.getName() + ">";
	}
}

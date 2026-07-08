package com.repograph.taint.domain.element;

import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.types.FieldReference;

import java.util.Objects;

/**
 * Represents a concrete domain element for a specific field.
 * <p>
 * This class extends domain behavior to include information about a particular field
 * in context with a given method (represented as `CGNode`).
 * </p>
 */
public class NormalFieldElement extends AbsLocalElement {

	/**
	 * Reference to the field associated with this domain element.
	 */
	private final FieldReference fieldRef;

	/**
	 * Constructs a new `NormalFieldElement` with the given parameters.
	 *
	 * @param id   a unique identifier for the element
	 * @param ref  the reference to the associated field
	 * @param node the control graph node representing the method context
	 */
	public NormalFieldElement(int id, FieldReference ref, CGNode node) {
		super(id, node);
		this.fieldRef = ref;
	}

	/**
	 * Retrieves the field reference associated with this domain element.
	 *
	 * @return the field reference object
	 */
	public FieldReference getFieldRef() {
		return this.fieldRef;
	}

	/**
	 * Compares this `NormalFieldElement` for equality with another object.
	 * <p>
	 * Two `NormalFieldElement` objects are considered equal if they have the same
	 * superclass properties and refer to the same field.
	 * </p>
	 *
	 * @param o the object to compare against
	 * @return true if the objects are equal, false otherwise
	 */
	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		if (!super.equals(o)) return false;
		NormalFieldElement that = (NormalFieldElement) o;
		return Objects.equals(fieldRef, that.fieldRef);
	}

	/**
	 * Generates a hash code for this `NormalFieldElement`.
	 * <p>
	 * The hash code incorporates the superclass hash code and the field reference,
	 * ensuring a unique representation based on the state of the object.
	 * </p>
	 *
	 * @return the computed hash code for this object
	 */
	@Override
	public int hashCode() {
		return Objects.hash(super.hashCode(), fieldRef);
	}

	/**
	 * Provides a string representation of this `NormalFieldElement`.
	 * <p>
	 * The string includes the value number and the field's name, presented in
	 * the format: `NFE<vn=valueNumber, fieldName>`.
	 * </p>
	 *
	 * @return a string representation of the domain element
	 */
	public String toString() {
		return "NFE<vn=" + this.getValueNumber() + ", " + this.fieldRef.getName() + ">";
	}


}

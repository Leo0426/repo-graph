package com.repograph.taint.domain.element;

import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.types.FieldReference;

import java.util.Objects;


/**
 * Represents a static field in the context of program analysis.
 * <p>
 * This class models a field that is statically defined and accessed. It is
 * immutable and serves to encapsulate properties of the field for analytical purposes.
 */
public class StaticFieldElement implements ICodeElement {
	/**
	 * Used for caching the hash code to ensure efficient operations.
	 */
	private final int hashCode = 0;

	/**
	 * Represents a value number for this element, defaulted to -1 (unused).
	 */
	private final int valueNumber = -1;

	/**
	 * Reference to the field that this element represents.
	 */
	private final FieldReference fieldRef;

	/**
	 * Constructs a new `StaticFieldElement` with the specified field reference.
	 *
	 * @param ref the reference to the static field this element represents
	 */
	public StaticFieldElement(FieldReference ref) {
		this.fieldRef = ref;
	}

	/**
	 * Returns the `FieldReference` associated with this static field element.
	 *
	 * @return the field reference of this element
	 */
	public FieldReference getFieldRef() {
		return this.fieldRef;
	}

	/**
	 * Returns a string representation of this static field element in the format
	 * `SFE<valueNumber, fieldRef>`.
	 *
	 * @return a formatted string representation of this object
	 */
	public String toString() {
		return "SFE<" + this.valueNumber + ", " + this.fieldRef.toString() + "> ";
	}

	public CGNode getCGNode() {
		return null;
	}

	/**
	 * Checks whether another object is equal to this `StaticFieldElement`.
	 * <p>
	 * Two `StaticFieldElement` objects are considered equal if:
	 * - They have the same `hashCode`.
	 * - Their `valueNumber` values are the same.
	 * - Their `fieldRef` references are structurally equal.
	 *
	 * @param o the object to compare against
	 * @return true if the objects are equal; false otherwise
	 */
	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		StaticFieldElement that = (StaticFieldElement) o;
		return Objects.equals(getFieldRef(), that.getFieldRef());
	}

	/**
	 * Generates a hash code for this object based on its `hashCode`,
	 * `valueNumber`, and `fieldRef`.
	 *
	 * @return the computed hash code for this element
	 */
	@Override
	public int hashCode() {
		return Objects.hash(hashCode, valueNumber, getFieldRef());
	}
}

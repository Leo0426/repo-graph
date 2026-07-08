package com.repograph.taint.domain.element;

import com.ibm.wala.ipa.callgraph.CGNode;


/**
 * Represents a concrete domain element for taint analysis with a unique identifier (id)
 * and the corresponding control graph node (CGNode).
 */
public class LocalElement extends AbsLocalElement {

	/**
	 * Constructs a LocalElement with the specified identifier and control graph node.
	 *
	 * @param id   the unique identifier for this element
	 * @param node the control graph node associated with this element
	 */
	public LocalElement(int id, CGNode node) {
		super(id, node);
	}

	/**
	 * Returns a string representation of this LocalElement, including its value number.
	 * This helps in debugging and logging scenarios where domain elements are involved.
	 */
	@Override
	public String toString() {
		return "LE [vn=" + this.getValueNumber() + "]";
	}
}

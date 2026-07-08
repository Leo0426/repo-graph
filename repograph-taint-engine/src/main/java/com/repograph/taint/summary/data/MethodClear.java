

package com.repograph.taint.summary.data;

import com.ibm.wala.types.MethodReference;

/**
 * A taint clearing definition. This class models the fact that a library method
 * clears an existing taint.
 *
 */
public class MethodClear extends AbstractMethodSummary {

	private final FlowClear clearDefinition;

	public MethodClear(MethodReference mr, FlowClear clearDefinition) {
		super(mr);
		this.clearDefinition = clearDefinition;
	}

	/**
	 * Gets the definition of the taint that shall be cleared
	 *
	 * @return The definition of the taint that shall be cleared
	 */
	public FlowClear getClearDefinition() {
		return clearDefinition;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = super.hashCode();
		result = prime * result + ((clearDefinition == null) ? 0 : clearDefinition.hashCode());
		return result;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (!super.equals(obj))
			return false;
		if (getClass() != obj.getClass())
			return false;
		MethodClear other = (MethodClear) obj;
		if (clearDefinition == null) {
			if (other.clearDefinition != null)
				return false;
		} else if (!clearDefinition.equals(other.clearDefinition))
			return false;
		return true;
	}

}

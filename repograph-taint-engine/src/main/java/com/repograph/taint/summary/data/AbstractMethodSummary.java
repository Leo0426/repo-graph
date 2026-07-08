

package com.repograph.taint.summary.data;

import com.ibm.wala.types.MethodReference;

/**
 * Abstract base class for all classes that represent method summaries
 *
 * @author Steven Arzt
 */
abstract class AbstractMethodSummary {

	protected final MethodReference mr;

	/**
	 * Creates a new instance of the {@link AbstractMethodSummary} class
	 *
	 * @param mr The signature of the method containing the flow
	 */
	AbstractMethodSummary(MethodReference mr) {
		this.mr = mr;
	}

	public MethodReference getMR() {
		return mr;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + ((mr == null) ? 0 : mr.hashCode());
		return result;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		AbstractMethodSummary other = (AbstractMethodSummary) obj;
		if (mr == null) {
			if (other.mr != null)
				return false;
		} else if (!mr.equals(other.mr))
			return false;
		return true;
	}

}

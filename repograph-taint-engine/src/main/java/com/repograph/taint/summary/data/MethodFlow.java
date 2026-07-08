

package com.repograph.taint.summary.data;

import com.ibm.wala.types.MethodReference;

/**
 * Class representing a summarized data flow in a given API method
 *
 * @author Steven Arzt
 */
public class MethodFlow extends AbstractMethodSummary {

	private final FlowSource from;
	private final FlowSink to;

	/**
	 * Creates a new instance of the MethodFlow class
	 *
	 * @param mr   The signature of the method containing the flow
	 * @param from The start of the data flow (source)
	 * @param to   The end of the data flow (sink)
	 */
	public MethodFlow(MethodReference mr, FlowSource from, FlowSink to) {
		super(mr);
		this.from = from;
		this.to = to;
	}

	/**
	 * Gets the source, i.e., the incoming flow
	 *
	 * @return The incoming flow
	 */
	public FlowSource source() {
		return from;
	}

	/**
	 * Gets the sink, i.e., the outgoing flow
	 *
	 * @return The outgoing flow
	 */
	public FlowSink sink() {
		return to;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (!super.equals(obj))
			return false;
		if (getClass() != obj.getClass())
			return false;
		MethodFlow other = (MethodFlow) obj;
		if (from == null) {
			if (other.from != null)
				return false;
		} else if (!from.equals(other.from))
			return false;
		if (to == null) {
			if (other.to != null)
				return false;
		} else if (!to.equals(other.to))
			return false;
		return true;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = super.hashCode();
		result = prime * result + ((from == null) ? 0 : from.hashCode());
		result = prime * result + ((to == null) ? 0 : to.hashCode());
		return result;
	}

	@Override
	public String toString() {
		return "{" + mr + " Source: [" + from.toString() + "] Sink: [" + to.toString() + "]" + "}";
	}

}

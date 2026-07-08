package com.repograph.taint.api.report.taint;

import com.repograph.taint.api.rules.IRule;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.StringJoiner;

/**
 * Represents the result of a taint analysis.
 * Encapsulates information about taint flows and associated rules.
 */
public class TaintResult {
	private final List<Flow> flows = new ArrayList<>();
	private IRule rule;

	/**
	 * Retrieves the list of taint flows in this result.
	 *
	 * @return a list of {@link Flow} objects representing taint flows.
	 */
	public List<Flow> getFlows() {
		return this.flows;
	}

	/**
	 * Adds a taint flow to the result if it is not already present.
	 *
	 * @param flow the {@link Flow} object to be added.
	 */
	public void addFlow(Flow flow) {
		if (!this.flows.contains(flow)) {
			this.flows.add(flow);
		}
	}

	/**
	 * Retrieves the rule associated with this taint result.
	 *
	 * @return the associated {@link IRule}.
	 */
	public IRule getRule() {
		return rule;
	}

	/**
	 * Sets the rule associated with this taint result.
	 *
	 * @param rule the {@link IRule} to associate with this result.
	 */
	public void setRule(IRule rule) {
		this.rule = rule;
	}

	/**
	 * Returns an iterator over the collection of taint flows.
	 *
	 * @return an {@link Iterator} for the list of {@link Flow} objects.
	 */
	public Iterator<Flow> iterator() {
		return flows.iterator();
	}

	/**
	 * Checks if there are no taint flows in this result.
	 *
	 * @return {@code true} if the taint flow list is empty, {@code false} otherwise.
	 */
	public boolean isEmpty() {
		return flows.isEmpty();
	}


	/**
	 * Returns a string representation of this {@link TaintResult}.
	 *
	 * @return a string containing the list of flows and associated rule.
	 */
	@Override
	public String toString() {
		return new StringJoiner(", ", TaintResult.class.getSimpleName() + "[", "]")
			.add("flows=" + flows)
			.add("rule=" + rule)
			.toString();
	}
}

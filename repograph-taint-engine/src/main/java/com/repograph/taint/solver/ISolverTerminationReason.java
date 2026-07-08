package com.repograph.taint.solver;


/**
 * Represents a reason for solver termination and supports combining multiple reasons to produce a unified result.
 */
@FunctionalInterface
public interface ISolverTerminationReason {

	/**
	 * Combines the current termination reason with another to produce a unified termination reason.
	 *
	 * @param reason another solver termination reason to combine with
	 * @return the combined solver termination reason
	 */
	ISolverTerminationReason combine(ISolverTerminationReason reason);
}

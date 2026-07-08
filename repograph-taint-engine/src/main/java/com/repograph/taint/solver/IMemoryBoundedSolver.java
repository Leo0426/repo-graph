package com.repograph.taint.solver;

/**
 * Interface representing a memory-bounded solver that handles solving operations
 * within memory constraints and provides lifecycle management capabilities.
 */
public interface IMemoryBoundedSolver {

	/**
	 * Forcefully terminates the solver's operation with a given reason.
	 *
	 * @param reason the reason for forcing termination of the solver
	 */
	void forceTerminate(ISolverTerminationReason reason);

	/**
	 * Checks if the solver has been terminated.
	 *
	 * @return true if the solver is terminated, false otherwise
	 */
	boolean isTerminated();

	/**
	 * Checks if the solver has been killed (forcefully stopped).
	 *
	 * @return true if the solver is killed, false otherwise
	 */
	boolean isKilled();

	/**
	 * Retrieves the reason for the solver's termination.
	 *
	 * @return the termination reason, or null if not terminated
	 */
	ISolverTerminationReason getTerminationReason();

	/**
	 * Resets the solver, clearing its state for a new operation.
	 */
	void reset();

	/**
	 * Adds a status listener to be notified of solver lifecycle events.
	 *
	 * @param notification the listener to be notified of solver status changes
	 */
	void addStatusListener(IMemoryBoundedSolverStatusNotification notification);

	/**
	 * Interface for listening to status changes of a memory-bounded solver.
	 */
	interface IMemoryBoundedSolverStatusNotification {

		/**
		 * Notifies that the solver has started.
		 *
		 * @param solver the solver instance that started
		 */
		void notifySolverStarted(IMemoryBoundedSolver solver);

		/**
		 * Notifies that the solver has terminated.
		 *
		 * @param solver the solver instance that terminated
		 */
		void notifySolverTerminated(IMemoryBoundedSolver solver);
	}
}

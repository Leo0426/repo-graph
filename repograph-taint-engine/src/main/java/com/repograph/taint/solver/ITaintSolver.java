package com.repograph.taint.solver;


import com.repograph.taint.api.report.taint.TaintResult;

import java.io.IOException;

/**
 * @author leolu
 * @since 2025/3/7
 */
public interface ITaintSolver {

	/**
	 * Executes the taint analysis logic.
	 *
	 * @throws IOException if an I/O operation fails during the analysis.
	 */
	void runAnalysis() throws IOException;

	/**
	 * Retrieves the result of the taint analysis, encapsulated in a TaintResult object.
	 *
	 * @return the result of the taint analysis.
	 */
	TaintResult getTaintResult();
}

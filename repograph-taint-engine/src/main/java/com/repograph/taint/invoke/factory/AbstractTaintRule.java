/*
 * MIT License
 *
 * Copyright (c) 2023 Leo Lu.  All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

package com.repograph.taint.invoke.factory;

import com.repograph.taint.api.report.taint.TaintResult;
import com.repograph.taint.api.rules.IRule;
import com.ibm.wala.ipa.callgraph.CallGraph;

/**
 * Action on taint flow.
 *
 * @author leolu
 * @since 2023/10/26
 */
public abstract class AbstractTaintRule implements IRule {

	private TaintResult taintResult;

	/**
	 * run on taint flows.
	 *
	 * @param callGraph cg
	 */
	public abstract void runOnTaint(CallGraph callGraph);

	/**
	 * get sas file.
	 *
	 * @param sasFilePath embedded file path.
	 * @return String
	 */
	public abstract String getSourceAndSinkFile(String sasFilePath);


	public TaintResult getTaintResult() {
		return taintResult;
	}

	public void setTaintResult(TaintResult taintResult) {
		this.taintResult = taintResult;
	}
}

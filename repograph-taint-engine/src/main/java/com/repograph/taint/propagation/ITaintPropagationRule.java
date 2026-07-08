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

package com.repograph.taint.propagation;

import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntSet;

/**
 * Interface for defining taint propagation rules in a static analysis engine.
 * Specifies methods for determining whether taint can propagate between control flow elements.
 *
 * @author Leo
 * @since 2024/11/18
 */
public interface ITaintPropagationRule {

	/**
	 * Determines if this rule can process a taint propagation at a given control flow element.
	 *
	 * @param paramInt                 The fact identifier for the current taint analysis.
	 * @param paramBasicBlockInContext The context of the basic block being analyzed.
	 * @return {@code true} if the rule can process the taint propagation, {@code false} otherwise.
	 */
	boolean canProcess(int paramInt, BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext);

	/**
	 * Propagates taint along a call flow edge between two control flow elements.
	 *
	 * @param paramInt The fact identifier for the taint.
	 * @param var1     The calling control flow element.
	 * @param var2     The called control flow element.
	 * @return A set of propagated taint facts; may be empty if no propagation occurs.
	 */
	IntSet propagateCallFlow(int paramInt, BasicBlockInContext<IExplodedBasicBlock> var1,
							 BasicBlockInContext<IExplodedBasicBlock> var2);

	/**
	 * Propagates taint directly from a call site to the return site.
	 *
	 * @param paramInt The fact identifier for the taint.
	 * @param var1     The call site control flow element.
	 * @return A set of propagated taint facts; may be empty if no propagation occurs.
	 */
	IntSet propagateCallToReturnFlow(int paramInt, BasicBlockInContext<IExplodedBasicBlock> var1);

}

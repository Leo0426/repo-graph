/*
 *
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
 *
 */

package com.repograph.taint.propagation;

import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;
import com.ibm.wala.util.intset.IntSet;
import com.ibm.wala.util.intset.MutableSparseIntSet;

import java.util.List;

public class PropagationRuleManager {

	private final ITaintPropagationRule[] rules;

	public PropagationRuleManager(List<ITaintPropagationRule> ruleList) {
		this.rules = ruleList.toArray(new ITaintPropagationRule[0]);
	}

	public boolean canProcess(int d1, BasicBlockInContext<IExplodedBasicBlock> callsite) {
		for (ITaintPropagationRule rule : this.rules) {
			if (rule.canProcess(d1, callsite)) {
				return true;
			}
		}
		return false;
	}

	public IntSet applyCallFlowFunction(int d1, BasicBlockInContext<IExplodedBasicBlock> callsite,
										BasicBlockInContext<IExplodedBasicBlock> dest) {
		MutableSparseIntSet res = MutableSparseIntSet.makeEmpty();
		for (ITaintPropagationRule rule : this.rules) {
			if (rule.canProcess(d1, callsite)) {
				IntSet ruleOut = rule.propagateCallFlow(d1, callsite, dest);
				res.addAll(ruleOut);
			}
		}
		return res;
	}

	public IntSet applyCallToReturnFlowFunction(int d1, BasicBlockInContext<IExplodedBasicBlock> callsite) {
		MutableSparseIntSet res = MutableSparseIntSet.makeEmpty();
		for (ITaintPropagationRule rule : this.rules) {
			if (rule.canProcess(d1, callsite)) {
				IntSet ruleOut = rule.propagateCallToReturnFlow(d1, callsite);
				if (ruleOut.isEmpty()) {
					return ruleOut;
				}
				res.addAll(ruleOut);
			}
		}

		return res;
	}
}

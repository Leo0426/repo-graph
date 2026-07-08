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

package com.repograph.taint.rules;

import com.repograph.taint.common.AliasAnalysis;
import com.ibm.wala.ipa.callgraph.CGNode;

/**
 * alias analysis
 *
 * @author leolu
 * @since 2024/1/4
 */
public class NodeAliasChecker {

	CGNode cgNode;

	int paramInt;

	SummaryTaintWrapper bw;

	NodeAliasChecker(SummaryTaintWrapper paramSummaryTaintWrapper, CGNode paramCGNode, int paramInt) {
		this.cgNode = paramCGNode;
		this.paramInt = paramInt;
		this.bw = paramSummaryTaintWrapper;
	}

	public boolean nodeAliasChecker(CGNode paramCGNode, int paramInt) {
		if (this.cgNode.getGraphNodeId() == paramCGNode.getGraphNodeId() && this.paramInt == paramInt) {
			return true;
		}
		AliasAnalysis aliasAnalysis = new AliasAnalysis(bw.getPa());
		return aliasAnalysis.mayAlias(this.cgNode, this.paramInt, paramCGNode, paramInt);
	}
}

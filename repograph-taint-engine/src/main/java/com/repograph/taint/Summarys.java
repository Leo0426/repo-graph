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

package com.repograph.taint;

import com.repograph.taint.domain.AccessPath;
import com.repograph.taint.prelim.FilterAccessPath;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ssa.DefUse;
import com.ibm.wala.ssa.SSAInstruction;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class Summarys {
	private static Summarys instance = new Summarys();

	private Map<CGNode, FilterAccessPath> summarys = new HashMap<>();

	public void clean() {
		this.summarys = new HashMap<>();
	}

	public static Summarys getInstance() {
		if (instance == null) {
			instance = new Summarys();
		}
		return instance;
	}

	public static void clear() {
		if (instance != null) {
			instance.summarys.clear();
			instance = null;
		}
	}

	public void addSummary(CGNode paramCGNode, int paramInt, AccessPath paramAccessPath) {
		DefUse defUse = paramAccessPath.getCGNode().getDU();
		int i = paramAccessPath.getBase();
		SSAInstruction sSAInstruction = defUse.getDef(i);
		assert i <= paramAccessPath.getCGNode().getMethod().getNumberOfParameters()
			|| sSAInstruction instanceof com.ibm.wala.ssa.SSANewInstruction
			|| sSAInstruction instanceof com.ibm.wala.ssa.SSAPhiInstruction
			|| sSAInstruction instanceof com.ibm.wala.ssa.SSAInvokeInstruction;

		if (!this.summarys.containsKey(paramCGNode)) {
			this.summarys.put(paramCGNode, new FilterAccessPath(this));
		}
		this.summarys.get(paramCGNode).addSummary(paramCGNode, paramInt, paramAccessPath);
	}

	public Set<AccessPath> getAPFromSummary(CGNode paramCGNode, int paramInt) {
		return !this.summarys.containsKey(paramCGNode)
			? new HashSet<>()
			: (this.summarys.get(paramCGNode)).getAccessPathFromCG(paramCGNode, paramInt);
	}
}

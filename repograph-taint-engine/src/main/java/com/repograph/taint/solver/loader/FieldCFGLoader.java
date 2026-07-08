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

package com.repograph.taint.solver.loader;

import com.repograph.taint.solver.SolverManager;
import com.repograph.taint.solver.FieldCFG;
import com.google.common.cache.CacheLoader;
import com.ibm.wala.cfg.ControlFlowGraph;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

import java.util.Objects;

public class FieldCFGLoader extends CacheLoader<ControlFlowGraph<SSAInstruction, IExplodedBasicBlock>, FieldCFG> {
	private final SolverManager solverManager;

	/**
	 * 创建 FieldCFGLoader 的新实例
	 *
	 * @param solverManager 不能为 null 的求解器管理器
	 * @throws NullPointerException 如果 solverManager 为 null
	 */
	public FieldCFGLoader(SolverManager solverManager) {
		this.solverManager = Objects.requireNonNull(solverManager, "solverManager must not be null");
	}

	@Override
	public FieldCFG load(ControlFlowGraph<SSAInstruction, IExplodedBasicBlock> cfg) {
		Objects.requireNonNull(cfg, "control flow graph must not be null");
		return new FieldCFG(this.solverManager, cfg);
	}
}

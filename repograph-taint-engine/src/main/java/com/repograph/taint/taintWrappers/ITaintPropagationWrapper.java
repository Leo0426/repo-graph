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

package com.repograph.taint.taintWrappers;

import com.repograph.taint.sourcesink.IKillDefinition;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.SSAInstruction;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

import java.util.List;
import java.util.Set;

/**
 * ITaintPropagationWrapper
 * <p>
 * Interface for managing taint propagation in static analysis of programs.
 * It provides methods to determine and control the flow of tainted data within method blocks.
 *
 * @author leolu
 * @since 2024/6/11
 */
public interface ITaintPropagationWrapper<T> {

	/**
	 * Retrieves a list of tainted values associated with a specific method block.
	 *
	 * @param paramBasicBlockInContext The basic block in the context of exploded basic blocks to be analyzed.
	 * @param paramT                   The specific taint marker or type being checked in the block.
	 * @return List of tainted items relevant to the block and taint type.
	 */
	List<T> getTaintsForMethod(BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext, T paramT);

	/**
	 * Determines if a given basic block does not allow any further taint propagation.
	 *
	 * @param paramBasicBlockInContext The basic block to check for taint exclusivity.
	 * @return true if the block is exclusive, meaning no taint can propagate further; false otherwise.
	 */
	boolean isExclusive(BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext);

	/**
	 * Determines if a specific SSA instruction within a block stops taint propagation.
	 *
	 * @param paramSSAInstruction The SSA instruction to check for exclusivity.
	 * @return true if the instruction is exclusive to taint propagation; false otherwise.
	 */
	boolean isExclusive(SSAInstruction paramSSAInstruction);

	/**
	 * Determines whether a taint should be "killed" (i.e., cleaned or considered safe) in a specific basic block.
	 *
	 * @param paramBasicBlockInContext The basic block in context.
	 * @param paramT                   The taint type or marker to check for removal.
	 * @return true if the taint should be killed in this block; false otherwise.
	 */
	boolean isKill(BasicBlockInContext<IExplodedBasicBlock> paramBasicBlockInContext, T paramT);

	/**
	 * Adds a set of kill definitions to the wrapper, defining rules for when and where taints should be considered killed.
	 *
	 * @param paramSet The set of kill definitions to add.
	 */
	void addKillSet(Set<IKillDefinition> paramSet);
}

package com.repograph.taint.common;

import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.ISSABasicBlock;
import com.ibm.wala.util.collections.Pair;


/**
 * Represents a pair of basic blocks in the context of CFG (Control Flow Graph) analysis.
 * This class is used to hold a pair of `BasicBlockInContext` objects to facilitate
 * various flow function calculations in static analysis.
 */
public class BlockPair<E extends ISSABasicBlock>
	extends Pair<BasicBlockInContext<E>, BasicBlockInContext<E>> {

	/**
	 * Constructs a BlockPair object with the specified first and second blocks.
	 *
	 * @param fst The first block in the pair.
	 * @param snd The second block in the pair.
	 */
	public BlockPair(BasicBlockInContext<E> fst, BasicBlockInContext<E> snd) {
		super(fst, snd);
	}
}

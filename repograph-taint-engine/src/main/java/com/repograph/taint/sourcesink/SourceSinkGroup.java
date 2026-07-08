package com.repograph.taint.sourcesink;

import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

public class SourceSinkGroup {
	private Set<BasicBlockInContext<IExplodedBasicBlock>> sourceBBs = new HashSet<>();
	private Set<BasicBlockInContext<IExplodedBasicBlock>> sinkBBs = new HashSet<>();

	public SourceSinkGroup(Set<BasicBlockInContext<IExplodedBasicBlock>> sources,
						   Set<BasicBlockInContext<IExplodedBasicBlock>> sinks) {
		this.sourceBBs = sources;
		this.sinkBBs = sinks;
	}

	public Set<BasicBlockInContext<IExplodedBasicBlock>> getSources() {
		return Collections.unmodifiableSet(sourceBBs);
	}

	public Set<BasicBlockInContext<IExplodedBasicBlock>> getSinks() {
		return Collections.unmodifiableSet(sinkBBs);
	}

	public boolean hasSource() {
		return !sourceBBs.isEmpty();
	}

	public boolean hasSink() {
		return !sinkBBs.isEmpty();
	}

	public Iterator<BasicBlockInContext<IExplodedBasicBlock>> sourceIterator() {
		return sourceBBs.iterator();
	}

	public Iterator<BasicBlockInContext<IExplodedBasicBlock>> sinkIterator() {
		return sinkBBs.iterator();
	}

	public void addSinkBB(BasicBlockInContext<IExplodedBasicBlock> bb) {
		sinkBBs.add(bb);
	}
}

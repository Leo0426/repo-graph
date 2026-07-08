package com.repograph.taint.domain;

import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

import java.util.Objects;
import java.util.StringJoiner;

/**
 * Represents the context of a source, which originates from invocations of other methods.
 * <p>
 * This context encapsulates a specific block within a control flow graph, as well as an
 * access path used to trace how program data flows through different parts of a method.
 * </p>
 * <p>
 * The {@code SourceContext} class provides functionality for identifying and comparing
 * the locations and access paths associated with sensitive data propagation in taint analysis.
 * </p>
 *
 * @param block the basic block in the control flow graph that corresponds to this source context
 * @param ap    the access path associated with the program data flow from this source context
 * @since 2024/10/30
 */
public record SourceContext(BasicBlockInContext<IExplodedBasicBlock> block, AccessPath ap) {

	@Override
	public boolean equals(Object o) {
		if (this == o) return true;
		if (o == null || getClass() != o.getClass()) return false;
		SourceContext that = (SourceContext) o;
		return Objects.equals(ap, that.ap) && Objects.equals(block, that.block);
	}

	@Override
	public int hashCode() {
		return Objects.hash(block, ap);
	}

	@Override
	public String toString() {
		return new StringJoiner(", ", SourceContext.class.getSimpleName() + "[", "]")
			.add("block=" + block)
			.add("ap=" + ap)
			.toString();
	}
}

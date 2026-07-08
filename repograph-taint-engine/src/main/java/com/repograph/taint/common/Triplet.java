package com.repograph.taint.common;

import java.util.StringJoiner;

/**
 * Immutable triplet class for grouping parameters.
 */
public record Triplet<A, B, C>(A fst, B snd, C third) {

	public static <A, B, C> Triplet<A, B, C> of(A a, B b, C c) {
		return new Triplet<>(a, b, c);
	}

	@Override
	public String toString() {
		return new StringJoiner(", ", Triplet.class.getSimpleName() + "[", "]")
			.add("fst=" + fst)
			.add("snd=" + snd)
			.add("third=" + third)
			.toString();
	}
}

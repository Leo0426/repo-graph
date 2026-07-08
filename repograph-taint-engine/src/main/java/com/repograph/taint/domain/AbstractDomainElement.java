package com.repograph.taint.domain;

import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ssa.SSAInstruction;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.StringJoiner;


/**
 * Represents an abstract domain element used in taint analysis.
 * <p>
 * This class serves as a base for concrete implementations of domain elements
 * that track program information such as source contexts and instruction mappings.
 * </p>
 */
public abstract class AbstractDomainElement implements IDomainElement {

	public List<Info> infos = new ArrayList<>();

	// It typically includes information about the program's control flow and access path.
	protected SourceContext reachableSource;

	public AbstractDomainElement(
		CGNode node, SourceContext source, SSAInstruction currentInst, AbstractDomainElement predecessor) {
		infos.add(new Info(node, currentInst, predecessor));
		this.reachableSource = source;
	}

	/**
	 * Adds all unique `Info` objects from the provided list to the current `infos` list.
	 * Duplicate entries are ignored based on their `equals` implementation.
	 */
	public void addAllInfo(List<Info> infos) {
		infos.forEach(info -> {
			if (!this.infos.contains(info)) {
				this.infos.add(info);
			}
		});
	}

	public List<Info> getInfos() {
		return infos;
	}

	public abstract CGNode getCGNode();

	public SourceContext getSource() {
		return reachableSource;
	}

	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + ((reachableSource == null) ? 0 : reachableSource.hashCode());
		return result;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj) {
			return true;
		}
		if (obj == null) {
			return false;
		}
		if (getClass() != obj.getClass()) {
			return false;
		}
		AbstractDomainElement other = (AbstractDomainElement) obj;
		if (reachableSource == null) {
			return other.reachableSource == null;
		} else {
			return reachableSource.equals(other.reachableSource);
		}
	}

	/**
	 * Encapsulates information about a domain element, including its node,
	 * the instruction that generated it, and a reference to its predecessor state.
	 */
	public static final class Info {
		private final CGNode node;
		private final SSAInstruction genInst;
		private final AbstractDomainElement predecessor;

		/**
		 * Constructs an `Info` object with the specified parameters.
		 *
		 * @param node        the CGNode representing the method containing this instruction
		 * @param currentInst the instruction generating this domain element
		 * @param predecessor the previous domain element in the analysis flow
		 */
		public Info(CGNode node, SSAInstruction currentInst, AbstractDomainElement predecessor) {
			this.node = node;
			this.genInst = currentInst;
			this.predecessor = predecessor;
		}

		public CGNode getNode() {
			return node;
		}

		public SSAInstruction getGenInst() {
			return genInst;
		}

		public AbstractDomainElement getPredecessor() {
			return predecessor;
		}

		@Override
		public boolean equals(Object o) {
			if (this == o) return true;
			if (o == null || getClass() != o.getClass()) return false;
			Info info = (Info) o;
			return Objects.equals(getNode(), info.getNode())
				&& Objects.equals(getGenInst(), info.getGenInst())
				&& Objects.equals(getPredecessor(), info.getPredecessor());
		}

		@Override
		public int hashCode() {
			return Objects.hash(getNode(), getGenInst(), getPredecessor());
		}

		@Override
		public String toString() {
			return new StringJoiner(", ", Info.class.getSimpleName() + "[", "]")
				.add("node=" + node)
				.add("genInst=" + genInst)
				.add("predecessor=" + predecessor)
				.toString();
		}
	}

	public int getValueNumber() {
		// TODO Auto-generated method stub
		return -1;
	}
}

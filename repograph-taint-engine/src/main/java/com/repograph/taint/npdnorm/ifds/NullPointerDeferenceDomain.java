package com.repograph.taint.npdnorm.ifds;

import com.repograph.taint.domain.element.ICodeElement;
import com.ibm.wala.dataflow.IFDS.PathEdge;
import com.ibm.wala.dataflow.IFDS.TabulationDomain;
import com.ibm.wala.ipa.callgraph.CGNode;
import com.ibm.wala.ipa.cfg.BasicBlockInContext;
import com.ibm.wala.ssa.analysis.IExplodedBasicBlock;

import java.util.*;
import java.util.stream.Stream;

/**
 * NullPointerDeferenceDomain contains a map from all taint
 * domain(any type of domain element) to a specific number.
 *
 * @param <T>
 * @author HeyOnePiece
 */
public class NullPointerDeferenceDomain<T> implements TabulationDomain<T, BasicBlockInContext<IExplodedBasicBlock>> {

	// one-to-one mapping
	private final Map<T, Integer> table;

	// A list contains all NPDDomain
	private final List<T> objects;

	// <bb, {node,vn}> null constant
	private final Map<CGNode, List<ICodeElement>> nullPointerConstant;

	public NullPointerDeferenceDomain(T zero) {
		this.table = new HashMap<>();
		this.objects = new ArrayList<>();
		this.nullPointerConstant = new HashMap<>();

		this.objects.add(zero);
		this.table.put(zero, 0);
	}

	public void addNullConstant(CGNode bb, ICodeElement ce) {
		if (this.nullPointerConstant.containsKey(bb)) {
			if (!this.nullPointerConstant.get(bb).contains(ce)) {
				this.nullPointerConstant.get(bb).add(ce);
			}
		} else {
			List<ICodeElement> ll = new LinkedList<>();
			ll.add(ce);
			this.nullPointerConstant.put(bb, ll);
		}

	}

	public List<ICodeElement> getNullConstant(CGNode bb) {
		return this.nullPointerConstant.get(bb);
	}

	public boolean containsNullConstant(CGNode bb) {
		return this.nullPointerConstant.containsKey(bb);
	}

	@Override
	public T getMappedObject(int n) throws NoSuchElementException {
		if (!isValidIndex(n)) {
			throw new NoSuchElementException();
		}
		return objects.get(n);
	}

	public boolean isValidIndex(int n) {
		return n >= 0 && n < objects.size();
	}

	/**
	 * pre-condition: hasMappedIndex(DomainElement);
	 */
	@Override
	public int getMappedIndex(Object o) {
		return this.table.get(o);
	}

	/**
	 * for convenient reason.
	 */
	@Override
	public boolean hasMappedIndex(T o) {
		return this.table.containsKey(o);
	}

	@Override
	public int getMaximumIndex() {
		return this.objects.size() - 1;
	}

	@Override
	public int getSize() {
		return this.objects.size();
	}

	@Override
	public int add(T o) {
		Integer i = this.table.get(o);
		if (i == null) {
			i = getMaximumIndex() + 1;
			this.objects.add(o);
			this.table.put(o, i);
		}
		return i;
	}

	@Override
	public Stream<T> stream() {
		return null;
	}

	@Override
	public Iterator<T> iterator() {
		return objects.iterator();
	}

	@Override
	public boolean hasPriorityOver(PathEdge<BasicBlockInContext<IExplodedBasicBlock>> p1,
								   PathEdge<BasicBlockInContext<IExplodedBasicBlock>> p2) {
		return false;
	}

	public void cleanup() {
		this.objects.clear();
		this.table.clear();
		this.nullPointerConstant.clear();
	}

}
